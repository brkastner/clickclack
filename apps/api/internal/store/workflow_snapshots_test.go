package store_test

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/openclaw/clickclack/apps/api/internal/store"
	"github.com/openclaw/clickclack/apps/api/internal/store/storetest"
)

func TestWorkflowSnapshotValidation(t *testing.T) {
	fixture := storetest.WorkflowSnapshotFixture()
	raw, err := json.Marshal(fixture)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.DecodeWorkflowSnapshot(raw); err != nil {
		t.Fatal(err)
	}
	for name, mutate := range map[string]func(*store.WorkflowSnapshot){
		"negative revision":  func(s *store.WorkflowSnapshot) { s.Source.Revision = -1 },
		"unsafe integer":     func(s *store.WorkflowSnapshot) { s.Source.Revision = 9007199254740992 },
		"status":             func(s *store.WorkflowSnapshot) { s.Run.Status = "finished" },
		"outcome":            func(s *store.WorkflowSnapshot) { s.Steps[0].Outcome = "success" },
		"duplicate attempt":  func(s *store.WorkflowSnapshot) { s.Steps[1].AttemptID = s.Steps[0].AttemptID },
		"small total":        func(s *store.WorkflowSnapshot) { s.Run.StepTotal = 1 },
		"false completeness": func(s *store.WorkflowSnapshot) { s.Run.StepTotal = 3 },
		"timestamp":          func(s *store.WorkflowSnapshot) { s.Steps[0].StartedAt = "yesterday" },
		"field length":       func(s *store.WorkflowSnapshot) { s.Source.RunID = strings.Repeat("x", 257) },
		"file change":        func(s *store.WorkflowSnapshot) { s.Files.Entries[0].Change = "written" },
		"truncated complete": func(s *store.WorkflowSnapshot) { s.Files.Truncated = true },
		"too many files":     func(s *store.WorkflowSnapshot) { s.Files.Entries = make([]store.WorkflowFile, 501) },
		"too many attempts":  func(s *store.WorkflowSnapshot) { s.Steps = make([]store.WorkflowAttempt, 1001) },
	} {
		t.Run(name, func(t *testing.T) {
			var s store.WorkflowSnapshot
			if err := json.Unmarshal(raw, &s); err != nil {
				t.Fatal(err)
			}
			mutate(&s)
			if err := s.Validate(); err == nil {
				t.Fatal("accepted invalid projection")
			}
		})
	}
	for _, path := range []string{"/tmp/private", "../secret", "src/../secret", "C:/secret", "src\\secret", "a\x00b", "a\nb", "a//b", "./a", "a/"} {
		t.Run(path, func(t *testing.T) {
			if store.SafeWorkflowPath(path) {
				t.Fatal("unsafe path accepted")
			}
		})
	}
	for _, path := range []string{"src/main.go", "папка/файл.ts", ".gitignore"} {
		if !store.SafeWorkflowPath(path) {
			t.Fatalf("safe path rejected: %s", path)
		}
	}
	for _, bad := range []string{
		strings.Replace(string(raw), `"files":{`, `"files":{"contents":"secret",`, 1),
		strings.Replace(string(raw), `,"stepsComplete":true`, ``, 1),
		strings.Replace(string(raw), `"revision":1`, `"revision":null`, 1),
		strings.Replace(string(raw), `"possiblyInterrupted":false`, `"possiblyInterrupted":null`, 1),
	} {
		if _, err := store.DecodeWorkflowSnapshot([]byte(bad)); err == nil {
			t.Fatalf("accepted missing/unknown/null field: %s", bad)
		}
	}
	fixture.Files = nil
	payload, digest, err := store.CanonicalWorkflowSnapshot(fixture)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := store.DecodeWorkflowSnapshot([]byte(payload))
	if err != nil || decoded.Files != nil {
		t.Fatalf("nullable files: %v", err)
	}
	_, same, err := store.CanonicalWorkflowSnapshot(decoded)
	if err != nil || same != digest {
		t.Fatal("unstable canonical digest")
	}
}
