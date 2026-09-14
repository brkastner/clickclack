package galleryactions

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
)

func valid() []Descriptor {
	return []Descriptor{{Version: 1, ID: "acme.remove-bg", Label: "Remove background", AcceptedMediaTypes: []string{"image/png"}, SchemaRevision: 1, Fields: []Field{{ID: "quality", Kind: "number", Label: "Quality", Min: ptr(1), Max: ptr(10)}, {ID: "format", Kind: "select", Label: "Format", Choices: []Choice{{ID: "png", Label: "PNG"}}}}}}
}
func ptr(v float64) *float64 { return &v }
func TestValidateDescriptors(t *testing.T) {
	for _, tc := range []struct {
		name   string
		mutate func([]Descriptor)
	}{
		{"valid", func([]Descriptor) {}}, {"unsupported version", func(d []Descriptor) { d[0].Version = 2 }}, {"unsupported field", func(d []Descriptor) { d[0].Fields[0].Kind = "html" }}, {"unbounded number", func(d []Descriptor) { d[0].Fields[0].Min = nil; d[0].Fields[0].Max = nil }}, {"callback cannot be an id", func(d []Descriptor) { d[0].ID = "https://evil.invalid" }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			d := valid()
			tc.mutate(d)
			err := ValidateDescriptors(d)
			if tc.name == "valid" && err != nil {
				t.Fatal(err)
			}
			if tc.name != "valid" && err == nil {
				t.Fatal("accepted unsafe descriptor")
			}
		})
	}
}
func TestValidateDescriptorsRejectsBoundariesAndInvalidFieldCombinations(t *testing.T) {
	duplicate := valid()
	duplicate = append(duplicate, duplicate[0])
	if err := ValidateDescriptors(duplicate); err == nil {
		t.Fatal("accepted duplicate action ID")
	}
	tooMany := make([]Descriptor, MaxActions+1)
	if err := ValidateDescriptors(tooMany); err == nil {
		t.Fatal("accepted too many actions")
	}
	if err := ValidateDescriptors(nil); err == nil {
		t.Fatal("accepted nil actions")
	}
	for _, tc := range []struct {
		name   string
		mutate func([]Descriptor)
	}{
		{"blank action label", func(d []Descriptor) { d[0].Label = " \t" }},
		{"duplicate media type", func(d []Descriptor) { d[0].AcceptedMediaTypes = []string{"image/png", "image/png"} }},
		{"invalid media type", func(d []Descriptor) { d[0].AcceptedMediaTypes = []string{"image/*"} }},
		{"invalid schema revision", func(d []Descriptor) { d[0].SchemaRevision = 0 }},
		{"duplicate field ID", func(d []Descriptor) { d[0].Fields = append(d[0].Fields, d[0].Fields[0]) }},
		{"number inverted bounds", func(d []Descriptor) { *d[0].Fields[0].Min = 11 }},
		{"number invalid step", func(d []Descriptor) { zero := 0.0; d[0].Fields[0].Step = &zero }},
		{"boolean bounds", func(d []Descriptor) { d[0].Fields[0].Kind = "boolean" }},
		{"select requires choices", func(d []Descriptor) { d[0].Fields[1].Choices = nil }},
		{"invalid choice upload ID", func(d []Descriptor) { d[0].Fields[1].Choices[0].UploadID = "not/an/id" }},
		{"images require integral bounded limits", func(d []Descriptor) {
			d[0].Fields = []Field{{ID: "images", Kind: "images", Label: "Images", Min: ptr(.5), Max: ptr(2), Choices: []Choice{}}}
		}},
		{"non-finite bound", func(d []Descriptor) { *d[0].Fields[0].Max = math.Inf(1) }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			d := valid()
			tc.mutate(d)
			if err := ValidateDescriptors(d); err == nil {
				t.Fatal("accepted invalid descriptor")
			}
		})
	}
}

func TestValidateValuesRequiresDeclaredTypedAndBoundedValues(t *testing.T) {
	step := 0.5
	fields := []Field{
		{ID: "enabled", Kind: "boolean", Label: "Enabled"},
		{ID: "amount", Kind: "number", Label: "Amount", Min: ptr(0), Max: ptr(2), Step: &step},
		{ID: "format", Kind: "select", Label: "Format", Choices: []Choice{{ID: "png", Label: "PNG"}}},
		{ID: "images", Kind: "images", Label: "Images", Min: ptr(1), Max: ptr(2), Choices: []Choice{{ID: "one", Label: "One"}, {ID: "two", Label: "Two"}}},
	}
	validValues := map[string]any{"enabled": true, "amount": 1.5, "format": "png", "images": []any{"one"}}
	if err := ValidateValues(fields, validValues); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name   string
		values map[string]any
	}{
		{"missing key", map[string]any{"enabled": true, "amount": 1.5, "format": "png"}},
		{"extra key", map[string]any{"enabled": true, "amount": 1.5, "format": "png", "images": []any{"one"}, "extra": true}},
		{"wrong boolean type", map[string]any{"enabled": "true", "amount": 1.5, "format": "png", "images": []any{"one"}}},
		{"unaligned number", map[string]any{"enabled": true, "amount": 1.25, "format": "png", "images": []any{"one"}}},
		{"unknown selection", map[string]any{"enabled": true, "amount": 1.5, "format": "jpg", "images": []any{"one"}}},
		{"duplicate image", map[string]any{"enabled": true, "amount": 1.5, "format": "png", "images": []any{"one", "one"}}},
		{"unknown image", map[string]any{"enabled": true, "amount": 1.5, "format": "png", "images": []any{"missing"}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if err := ValidateValues(fields, tc.values); err == nil {
				t.Fatal("accepted invalid values")
			}
		})
	}
}

func TestDecodeRejectsTrailingJSONAndFieldSpecificWireProperties(t *testing.T) {
	for _, tc := range []struct {
		name   string
		data   string
		target any
	}{
		{"trailing JSON", `{"id":"x"} {}`, &map[string]any{}},
		{"null root", `null`, &map[string]any{}},
		{"boolean step", `{"id":"enabled","kind":"boolean","label":"Enabled","step":1}`, &Field{}},
		{"number choices", `{"id":"amount","kind":"number","label":"Amount","choices":[]}`, &Field{}},
		{"choice unknown property", `{"id":"png","label":"PNG","callback":"https://evil.invalid"}`, &Choice{}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if err := Decode([]byte(tc.data), tc.target); err == nil {
				t.Fatal("accepted invalid wire input")
			}
		})
	}
}

func TestSubmissionDigestIsPayloadBoundAndStable(t *testing.T) {
	a := SubmissionDigest("s", "retry-1", "{\"x\":1}")
	if a != SubmissionDigest("s", "retry-1", "{\"x\":1}") {
		t.Fatal("not stable")
	}
	if a == SubmissionDigest("s", "retry-1", "{\"x\":2}") {
		t.Fatal("not payload bound")
	}
}

func TestStrictGalleryWireContract(t *testing.T) {
	good := `{"version":1,"id":"synthetic.adjust","label":"Adjust","accepted_media_types":["image/png"],"schema_revision":1,"fields":[{"id":"images","kind":"images","label":"Images","min":0,"max":2,"dynamic":true,"choices":[]},{"id":"amount","kind":"number","label":"Amount","min":1,"max":3,"step":0.5,"default":1.5}]}`
	var d Descriptor
	if err := Decode([]byte(good), &d); err != nil {
		t.Fatal(err)
	}
	if err := ValidateDescriptors([]Descriptor{d}); err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(d)
	if err != nil {
		t.Fatal(err)
	}
	if err = Decode(encoded, &d); err != nil {
		t.Fatal(err)
	}
	if err = ValidateDescriptors([]Descriptor{d}); err != nil {
		t.Fatal("roundtrip", err)
	}
	for _, tc := range []struct{ name, from, to string }{
		{"unknown descriptor", `"version":1`, `"html":"x","version":1`},
		{"duplicate key", `"version":1`, `"version":1,"version":1`},
		{"null", `"default":1.5`, `"default":null`},
		{"unaligned default", `"default":1.5`, `"default":1.25`},
		{"zero step", `"step":0.5`, `"step":0`},
		{"unsafe step", `"step":0.5`, `"step":1e-20`},
		{"bad bounds", `"max":3`, `"max":0`},
		{"fractional images", `"min":0`, `"min":0.5`},
		{"unbounded images", `"max":2`, `"max":101`},
		{"unknown field", `"dynamic":true`, `"callback_url":"https://evil"`},
		{"missing fields", `,"fields":`, `,"wrong":`},
		{"missing version", `"version":1,`, ``},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var bad Descriptor
			err := Decode([]byte(strings.Replace(good, tc.from, tc.to, 1)), &bad)
			if err == nil {
				err = ValidateDescriptors([]Descriptor{bad})
			}
			if err == nil {
				t.Fatal("accepted invalid wire contract")
			}
		})
	}
	for _, value := range []string{`{"images":[],"amount":1.5}`, `{"images":[],"amount":1.25}`, `{"images":[],"amount":1.5,"extra":true}`, `{"images":["foreign"],"amount":1.5}`} {
		var values map[string]any
		if err = Decode([]byte(value), &values); err != nil {
			t.Fatal(err)
		}
		err = ValidateValues(d.Fields, values)
		if (err == nil) != (value == `{"images":[],"amount":1.5}`) {
			t.Fatalf("unexpected validation %s: %v", value, err)
		}
	}
}
