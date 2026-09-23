// Package galleryactions validates the deliberately small declarative contract
// used by installed gallery-action producers. It contains no rendering, URL
// fetching, or executable extension points.
package galleryactions

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"regexp"
	"strings"
	"unicode/utf8"
)

const (
	ProtocolVersion   = 1
	MaxActions        = 32
	MaxFields         = 16
	MaxChoices        = 100
	MaxDynamicChoices = 500
)

var actionID = regexp.MustCompile(`^[a-z0-9][a-z0-9_.-]{0,63}$`)

// Descriptor is public installation capability data. IDs are namespaced by the
// installation at storage time; labels never participate in authorization.
type Descriptor struct {
	Version            int      `json:"version"`
	ID                 string   `json:"id"`
	Label              string   `json:"label"`
	AcceptedMediaTypes []string `json:"accepted_media_types"`
	SchemaRevision     int      `json:"schema_revision"`
	Fields             []Field  `json:"fields"`
}

type Field struct {
	ID       string   `json:"id"`
	Kind     string   `json:"kind"` // boolean, number, select, images
	Label    string   `json:"label"`
	Required bool     `json:"required,omitempty"`
	Min      *float64 `json:"min,omitempty"`
	Max      *float64 `json:"max,omitempty"`
	Choices  []Choice `json:"choices,omitempty"`
	Step     *float64 `json:"step,omitempty"`
	Default  any      `json:"default,omitempty"`
	Dynamic  bool     `json:"dynamic,omitempty"`
}

type Choice struct {
	ID       string `json:"id"`
	Label    string `json:"label"`
	UploadID string `json:"upload_id,omitempty"`
}

// ValidateDescriptors rejects unsafe or unbounded controls before descriptors
// are persisted. In particular URLs, callbacks, HTML, and arbitrary paths have
// no representable field in this model.
func ValidateDescriptors(descriptors []Descriptor) error {
	if len(descriptors) > MaxActions {
		return fmt.Errorf("at most %d actions are allowed", MaxActions)
	}
	if descriptors == nil {
		return errors.New("gallery_actions must be an array")
	}
	seen := map[string]bool{}
	for i, d := range descriptors {
		if d.Version != ProtocolVersion {
			return fmt.Errorf("actions[%d]: unsupported version", i)
		}
		if !actionID.MatchString(d.ID) || seen[d.ID] {
			return fmt.Errorf("actions[%d]: invalid or duplicate id", i)
		}
		seen[d.ID] = true
		if err := boundedText(d.Label, 100); err != nil {
			return fmt.Errorf("actions[%d].label: %w", i, err)
		}
		if len(d.AcceptedMediaTypes) == 0 || len(d.AcceptedMediaTypes) > 8 {
			return fmt.Errorf("actions[%d]: media types must contain 1..8 entries", i)
		}
		media := map[string]bool{}
		for _, m := range d.AcceptedMediaTypes {
			if media[m] {
				return errors.New("duplicate media type")
			}
			media[m] = true
			if !regexp.MustCompile(`^[a-z]+/[a-z0-9.+-]+$`).MatchString(m) {
				return fmt.Errorf("actions[%d]: invalid media type", i)
			}
		}
		if d.SchemaRevision < 1 || d.SchemaRevision > 2147483647 || d.Fields == nil || len(d.Fields) > MaxFields {
			return fmt.Errorf("actions[%d]: invalid schema", i)
		}
		fields := map[string]bool{}
		for j, f := range d.Fields {
			if !actionID.MatchString(f.ID) || fields[f.ID] {
				return fmt.Errorf("actions[%d].fields[%d]: invalid or duplicate id", i, j)
			}
			fields[f.ID] = true
			if err := boundedText(f.Label, 100); err != nil {
				return fmt.Errorf("actions[%d].fields[%d].label: %w", i, j, err)
			}
			if err := validateField(f); err != nil {
				return err
			}
			switch f.Kind {
			case "boolean", "number", "select", "images":
			default:
				return fmt.Errorf("actions[%d].fields[%d]: unsupported control", i, j)
			}
			if f.Kind == "number" && (f.Min == nil || f.Max == nil) {
				return fmt.Errorf("actions[%d].fields[%d]: number needs both bounds", i, j)
			}
			if f.Min != nil && f.Max != nil && *f.Min > *f.Max {
				return fmt.Errorf("actions[%d].fields[%d]: invalid bounds", i, j)
			}
			limit := MaxChoices
			if f.Kind == "images" && f.Dynamic {
				limit = MaxDynamicChoices
			}
			if len(f.Choices) > limit || (f.Kind == "select" && len(f.Choices) == 0) {
				return fmt.Errorf("actions[%d].fields[%d]: invalid choices", i, j)
			}
			choices := map[string]bool{}
			for _, c := range f.Choices {
				if !actionID.MatchString(c.ID) || choices[c.ID] || (c.UploadID != "" && !regexp.MustCompile(`^[a-zA-Z0-9_.-]{1,128}$`).MatchString(c.UploadID)) {
					return fmt.Errorf("actions[%d].fields[%d]: invalid choice", i, j)
				}
				choices[c.ID] = true
				if err := boundedText(c.Label, 100); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

func boundedText(s string, max int) error {
	if strings.TrimSpace(s) == "" || utf8.RuneCountInString(s) > max {
		return errors.New("must be non-empty and bounded")
	}
	return nil
}

// SubmissionDigest makes retry identity payload-bound. Callers persist it with
// the session and must return conflict rather than re-execute on a mismatch.
func SubmissionDigest(sessionID, submissionID, canonicalPayload string) string {
	h := sha256.Sum256([]byte(sessionID + "\x00" + submissionID + "\x00" + canonicalPayload))
	return hex.EncodeToString(h[:])
}

// Decode rejects nulls, unknown properties, duplicate keys and trailing JSON.
// It is shared by all producer and browser request boundaries.
func Decode(data []byte, target any) error {
	d := json.NewDecoder(bytes.NewReader(data))
	var walk func() error
	walk = func() error {
		t, err := d.Token()
		if err != nil {
			return err
		}
		if t == nil {
			return errors.New("null is not supported")
		}
		if delim, ok := t.(json.Delim); ok {
			seen := map[string]bool{}
			for d.More() {
				if delim == '{' {
					key, err := d.Token()
					if err != nil {
						return err
					}
					k, ok := key.(string)
					if !ok || seen[k] {
						return errors.New("duplicate object key")
					}
					seen[k] = true
				}
				if err := walk(); err != nil {
					return err
				}
			}
			_, err = d.Token()
			return err
		}
		return nil
	}
	if err := walk(); err != nil {
		return err
	}
	if _, err := d.Token(); err != io.EOF {
		return errors.New("trailing JSON")
	}
	d = json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	return d.Decode(target)
}
func finite(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) && math.Abs(v) <= 1e12 }
func aligned(v, min float64, step *float64) bool {
	if step == nil {
		return true
	}
	n := (v - min) / *step
	return finite(n) && math.Abs(n-math.Round(n)) < 1e-9
}
func validateField(f Field) error {
	bad := errors.New("invalid field constraints or default")
	if f.Kind != "number" && f.Kind != "images" && (f.Min != nil || f.Max != nil) {
		return bad
	}
	if f.Kind != "number" && f.Step != nil {
		return bad
	}
	if f.Kind != "images" && f.Dynamic {
		return bad
	}
	if f.Kind != "images" && f.Kind != "select" && f.Choices != nil {
		return bad
	}
	for _, bound := range []*float64{f.Min, f.Max, f.Step} {
		if bound != nil && !finite(*bound) {
			return bad
		}
	}
	if f.Step != nil && *f.Step <= 0 {
		return bad
	}
	if f.Kind == "images" && (f.Min == nil || f.Max == nil || *f.Min < 0 || *f.Max > MaxChoices || math.Trunc(*f.Min) != *f.Min || math.Trunc(*f.Max) != *f.Max || f.Choices == nil) {
		return bad
	}
	if f.Default != nil {
		if err := ValidateValues([]Field{f}, map[string]any{f.ID: f.Default}); err != nil {
			return bad
		}
	}
	return nil
}

// ValidateValues requires exactly the declared keys, including effective defaults.
func ValidateValues(fields []Field, values map[string]any) error {
	if len(fields) != len(values) || values == nil {
		return errors.New("values must have exactly the declared fields")
	}
	for _, f := range fields {
		v, ok := values[f.ID]
		if !ok || v == nil {
			return errors.New("missing field")
		}
		valid := false
		switch f.Kind {
		case "boolean":
			_, valid = v.(bool)
		case "number":
			n, ok := v.(float64)
			valid = ok && finite(n) && f.Min != nil && f.Max != nil && n >= *f.Min && n <= *f.Max && aligned(n, *f.Min, f.Step)
		case "select":
			id, ok := v.(string)
			if ok {
				for _, c := range f.Choices {
					if c.ID == id {
						valid = true
					}
				}
			}
		case "images":
			ids, ok := v.([]any)
			if ok && f.Min != nil && f.Max != nil && len(ids) >= int(*f.Min) && len(ids) <= int(*f.Max) {
				valid = true
				seen := map[string]bool{}
				for _, raw := range ids {
					id, ok := raw.(string)
					found := false
					for _, c := range f.Choices {
						if c.ID == id {
							found = true
						}
					}
					if !ok || !found || seen[id] {
						valid = false
					}
					seen[id] = true
				}
			}
		}
		if !valid {
			return fmt.Errorf("invalid value for %s", f.ID)
		}
	}
	return nil
}

func requiredKeys(data []byte, keys ...string) error {
	var value map[string]json.RawMessage
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	for _, k := range keys {
		if _, ok := value[k]; !ok {
			return fmt.Errorf("%s is required", k)
		}
	}
	return nil
}
func (d *Descriptor) UnmarshalJSON(data []byte) error {
	type plain Descriptor
	var v plain
	if err := Decode(data, &v); err != nil {
		return err
	}
	if err := requiredKeys(data, "version", "id", "label", "accepted_media_types", "schema_revision", "fields"); err != nil {
		return err
	}
	*d = Descriptor(v)
	return nil
}
func (f *Field) UnmarshalJSON(data []byte) error {
	type plain Field
	var v plain
	if err := Decode(data, &v); err != nil {
		return err
	}
	if err := requiredKeys(data, "id", "kind", "label"); err != nil {
		return err
	}
	var keys map[string]json.RawMessage
	if err := json.Unmarshal(data, &keys); err != nil {
		return err
	}
	allowed := map[string]bool{"id": true, "kind": true, "label": true, "required": true, "default": true}
	switch v.Kind {
	case "number":
		allowed["min"] = true
		allowed["max"] = true
		allowed["step"] = true
	case "select":
		allowed["choices"] = true
	case "images":
		allowed["choices"] = true
		allowed["min"] = true
		allowed["max"] = true
		allowed["dynamic"] = true
	}
	for key := range keys {
		if !allowed[key] {
			return fmt.Errorf("%s is not valid for %s", key, v.Kind)
		}
	}
	*f = Field(v)
	return nil
}
func (c *Choice) UnmarshalJSON(data []byte) error {
	type plain Choice
	var v plain
	if err := Decode(data, &v); err != nil {
		return err
	}
	if err := requiredKeys(data, "id", "label"); err != nil {
		return err
	}
	*c = Choice(v)
	return nil
}

func (f Field) MarshalJSON() ([]byte, error) {
	type plain Field
	data, err := json.Marshal(plain(f))
	if err != nil {
		return nil, err
	}
	if f.Kind != "images" && f.Kind != "select" {
		return data, nil
	}
	var fields map[string]json.RawMessage
	if err = json.Unmarshal(data, &fields); err != nil {
		return nil, err
	}
	if _, ok := fields["choices"]; !ok {
		fields["choices"] = json.RawMessage("[]")
	}
	return json.Marshal(fields)
}
