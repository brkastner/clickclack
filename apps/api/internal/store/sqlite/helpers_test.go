package sqlite

import "testing"

func TestNormalizeHandleAllowsUnicodeLettersAndNumbers(t *testing.T) {
	t.Parallel()

	for _, value := range []string{"liz", "лиза", "кай2"} {
		if got, err := normalizeHandle(value); err != nil || got != value {
			t.Errorf("normalizeHandle(%q) = %q, %v", value, got, err)
		}
	}
	for _, value := range []string{"@", "a", "two words"} {
		if _, err := normalizeHandle(value); err == nil {
			t.Errorf("normalizeHandle(%q) unexpectedly succeeded", value)
		}
	}
}
