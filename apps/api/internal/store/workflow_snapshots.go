package store

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

const WorkflowSnapshotSchema = "clickclack.workflow-snapshot.v1"
const MaxWorkflowSnapshotBytes = 512 * 1024

var ErrWorkflowRevisionConflict = errors.New("workflow snapshot revision has different content")

type WorkflowSnapshot struct {
	Schema string            `json:"schema"`
	Source WorkflowSource    `json:"source"`
	Run    WorkflowSummary   `json:"run"`
	Steps  []WorkflowAttempt `json:"steps"`
	Files  *WorkflowFiles    `json:"files"`
}
type WorkflowSource struct {
	Provider  string `json:"provider"`
	SessionID string `json:"sessionId"`
	RunID     string `json:"runId"`
	Revision  int64  `json:"revision"`
}
type WorkflowSummary struct {
	WorkflowName        string  `json:"workflowName"`
	Status              string  `json:"status"`
	Reason              *string `json:"reason"`
	PossiblyInterrupted bool    `json:"possiblyInterrupted"`
	StartedAt           *string `json:"startedAt"`
	FinishedAt          *string `json:"finishedAt"`
	StepTotal           int64   `json:"stepTotal"`
	StepsComplete       bool    `json:"stepsComplete"`
}
type WorkflowAttempt struct {
	AttemptID  string `json:"attemptId"`
	NodeID     string `json:"nodeId"`
	NodeType   string `json:"nodeType"`
	Outcome    string `json:"outcome"`
	StartedAt  string `json:"startedAt"`
	FinishedAt string `json:"finishedAt"`
}
type WorkflowFiles struct {
	Source       string         `json:"source"`
	Basis        string         `json:"basis"`
	BaseRevision string         `json:"baseRevision"`
	Attribution  string         `json:"attribution"`
	Complete     bool           `json:"complete"`
	Truncated    bool           `json:"truncated"`
	Entries      []WorkflowFile `json:"entries"`
}
type WorkflowFile struct {
	Path    string `json:"path"`
	Change  string `json:"change"`
	OldPath string `json:"oldPath,omitempty"`
}
type WorkflowRunRecord struct {
	ID                   string           `json:"id"`
	WorkspaceID          string           `json:"workspace_id"`
	ChannelID            string           `json:"channel_id,omitempty"`
	DirectConversationID string           `json:"direct_conversation_id,omitempty"`
	ProducerID           string           `json:"producer_id"`
	Snapshot             WorkflowSnapshot `json:"snapshot"`
	UpdatedAt            string           `json:"updated_at"`
}
type WorkflowRunPage struct {
	Runs       []WorkflowRunRecord `json:"runs"`
	NextCursor string              `json:"next_cursor,omitempty"`
}
type PublishWorkflowSnapshotInput struct {
	WorkspaceID          string
	ChannelID            string
	DirectConversationID string
	ProducerID           string
	Snapshot             WorkflowSnapshot
}

// DecodeWorkflowSnapshot rejects missing fields as well as unknown fields. The
// typed serialization below is the canonical digest, independent of key order.
func DecodeWorkflowSnapshot(raw []byte) (WorkflowSnapshot, error) {
	var s WorkflowSnapshot
	if len(raw) > MaxWorkflowSnapshotBytes || !utf8.Valid(raw) {
		return s, errors.New("invalid snapshot size or encoding")
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(&s); err != nil {
		return s, err
	}
	if err := d.Decode(new(any)); err != io.EOF {
		return s, errors.New("expected one snapshot")
	}
	var object map[string]json.RawMessage
	if err := json.Unmarshal(raw, &object); err != nil {
		return s, err
	}
	required := func(obj map[string]json.RawMessage, fields string, nullable string) error {
		for _, key := range strings.Fields(fields) {
			value, ok := obj[key]
			if !ok || (string(value) == "null" && !strings.Contains(" "+nullable+" ", " "+key+" ")) {
				return fmt.Errorf("snapshot field %s is required", key)
			}
		}
		return nil
	}
	if err := required(object, "schema source run steps files", "files"); err != nil {
		return s, err
	}
	for key, fields := range map[string]string{"source": "provider sessionId runId revision", "run": "workflowName status reason possiblyInterrupted startedAt finishedAt stepTotal stepsComplete", "files": "source basis baseRevision attribution complete truncated entries"} {
		if string(object[key]) == "null" {
			continue
		}
		var obj map[string]json.RawMessage
		if err := json.Unmarshal(object[key], &obj); err != nil {
			return s, err
		}
		if err := required(obj, fields, "reason startedAt finishedAt"); err != nil {
			return s, err
		}
	}
	var steps []map[string]json.RawMessage
	if err := json.Unmarshal(object["steps"], &steps); err != nil {
		return s, err
	}
	for _, step := range steps {
		if err := required(step, "attemptId nodeId nodeType outcome startedAt finishedAt", ""); err != nil {
			return s, err
		}
	}
	if s.Files != nil {
		var f map[string]json.RawMessage
		if err := json.Unmarshal(object["files"], &f); err != nil {
			return s, err
		}
		var entries []map[string]json.RawMessage
		if err := json.Unmarshal(f["entries"], &entries); err != nil {
			return s, err
		}
		for _, entry := range entries {
			if err := required(entry, "path change", ""); err != nil {
				return s, err
			}
			if old, ok := entry["oldPath"]; ok && (string(old) == "null" || string(old) == `""`) {
				return s, errors.New("oldPath must be a safe nonempty path")
			}
		}
	}
	return s, s.Validate()
}
func workflowText(s string, max int, empty bool) bool {
	return (empty || strings.TrimSpace(s) != "") && utf8.ValidString(s) && utf8.RuneCountInString(s) <= max && !strings.ContainsRune(s, 0)
}
func workflowEnum(s, values string) bool {
	return strings.Contains("|"+values+"|", "|"+s+"|") && s != ""
}
func workflowTime(s string) bool { _, err := time.Parse(time.RFC3339Nano, s); return err == nil }

// SafeWorkflowPath accepts only bounded portable relative paths, never roots or traversal.
func SafeWorkflowPath(p string) bool {
	if !workflowText(p, 1024, false) || strings.HasPrefix(p, "/") || strings.ContainsAny(p, "\\:") {
		return false
	}
	for _, r := range p {
		if unicode.IsControl(r) {
			return false
		}
	}
	for _, part := range strings.Split(p, "/") {
		if part == "" || part == "." || part == ".." {
			return false
		}
	}
	return true
}
func (s WorkflowSnapshot) Validate() error {
	invalid := errors.New("invalid workflow snapshot")
	if s.Schema != WorkflowSnapshotSchema || s.Source.Provider != "pi-workflows" || !workflowText(s.Source.SessionID, 256, false) || !workflowText(s.Source.RunID, 256, false) || s.Source.Revision < 0 || s.Source.Revision > 9007199254740991 {
		return invalid
	}
	r := s.Run
	if !workflowText(r.WorkflowName, 256, false) || !workflowEnum(r.Status, "queued|running|waiting|paused|completed|failed|timed_out|cancelled|ambiguous") || (r.Reason != nil && !workflowText(*r.Reason, 4096, true)) || r.StepTotal < int64(len(s.Steps)) || r.StepTotal > 9007199254740991 || (r.StepsComplete && r.StepTotal != int64(len(s.Steps))) || s.Steps == nil || len(s.Steps) > 1000 {
		return invalid
	}
	for _, ts := range []*string{r.StartedAt, r.FinishedAt} {
		if ts != nil && (len(*ts) > 256 || !workflowTime(*ts)) {
			return invalid
		}
	}
	seen := map[string]bool{}
	for _, step := range s.Steps {
		if !workflowText(step.AttemptID, 256, false) || !workflowText(step.NodeID, 256, false) || !workflowText(step.NodeType, 256, false) || seen[step.AttemptID] || !workflowEnum(step.Outcome, "ok|timed_out|failed|cancelled") || len(step.StartedAt) > 256 || len(step.FinishedAt) > 256 || !workflowTime(step.StartedAt) || !workflowTime(step.FinishedAt) {
			return invalid
		}
		seen[step.AttemptID] = true
	}
	if f := s.Files; f != nil {
		if f.Source != "host-git" || f.Basis != "cumulative-since-base" || !workflowText(f.BaseRevision, 256, false) || !workflowEnum(f.Attribution, "clean-baseline|includes-preexisting-changes") || (f.Complete && f.Truncated) || f.Entries == nil || len(f.Entries) > 500 {
			return invalid
		}
		for _, file := range f.Entries {
			if !SafeWorkflowPath(file.Path) || (file.OldPath != "" && !SafeWorkflowPath(file.OldPath)) || !workflowEnum(file.Change, "added|modified|deleted|renamed|copied|type_changed|unmerged|untracked") {
				return invalid
			}
		}
	}
	raw, err := json.Marshal(s)
	if err != nil {
		return err
	}
	if len(raw) > MaxWorkflowSnapshotBytes {
		return invalid
	}
	return nil
}
func CanonicalWorkflowSnapshot(s WorkflowSnapshot) (string, string, error) {
	if err := s.Validate(); err != nil {
		return "", "", err
	}
	raw, err := json.Marshal(s)
	if err != nil {
		return "", "", err
	}
	sum := sha256.Sum256(raw)
	return string(raw), hex.EncodeToString(sum[:]), nil
}
