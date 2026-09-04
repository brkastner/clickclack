package store

import (
	"strings"
	"testing"
)

func strPtr(s string) *string { return &s }

// Characterization tests pinning NormalizeAppearancePreferencesPatch and
// AppearancePreferencesPatchEmpty, the appearance-preferences validators invoked
// from both the sqlite and postgres update paths
// (internal/store/{sqlite,postgres}.go:~294/280 and ~364/350). Both shipped with
// no direct coverage, so the per-field allow-list, the default-alias-to-empty
// canonicalization, the invalid-value error path, and the nil round-trip could
// regress silently. These cases drive the real exported functions.

// The "default" alias for each field (system/signal/standard/comfortable) must
// canonicalize to the empty string — the stored representation of "use the
// default" — while an explicit non-default value passes through unchanged.
func TestNormalizeAppearancePreferencesPatch_CanonicalizesDefaultsToEmpty(t *testing.T) {
	out, err := NormalizeAppearancePreferencesPatch(AppearancePreferencesPatch{
		ColorMode:     strPtr("system"),
		BoardTheme:    strPtr("signal"),
		MessageLayout: strPtr("standard"),
		Density:       strPtr("comfortable"),
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	for name, got := range map[string]*string{
		"ColorMode":     out.ColorMode,
		"BoardTheme":    out.BoardTheme,
		"MessageLayout": out.MessageLayout,
		"Density":       out.Density,
	} {
		if got == nil {
			t.Errorf("%s canonicalized to nil, want non-nil empty string", name)
			continue
		}
		if *got != "" {
			t.Errorf("%s default alias not canonicalized: got %q, want %q", name, *got, "")
		}
	}
}

// Explicit non-default values must survive normalization verbatim; this is the
// counterpart to the default-alias case and bites if an allow-list entry is
// dropped or remapped.
func TestNormalizeAppearancePreferencesPatch_PassesThroughExplicitValues(t *testing.T) {
	out, err := NormalizeAppearancePreferencesPatch(AppearancePreferencesPatch{
		ColorMode:     strPtr("dark"),
		BoardTheme:    strPtr("iris"),
		MessageLayout: strPtr("outlined"),
		Density:       strPtr("compact"),
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := map[string]struct {
		got    *string
		expect string
	}{
		"ColorMode":     {out.ColorMode, "dark"},
		"BoardTheme":    {out.BoardTheme, "iris"},
		"MessageLayout": {out.MessageLayout, "outlined"},
		"Density":       {out.Density, "compact"},
	}
	for name, w := range want {
		if w.got == nil || *w.got != w.expect {
			t.Errorf("%s not passed through: got %v, want %q", name, deref(w.got), w.expect)
		}
	}
}

// A nil field pointer means "field not being patched" and must round-trip as
// nil, never as an allocated empty string — the callers gate the DB write on
// AppearancePreferencesPatchEmpty, so a nil-to-empty mutation would flip an
// untouched field into a write.
func TestNormalizeAppearancePreferencesPatch_NilFieldsStayNil(t *testing.T) {
	out, err := NormalizeAppearancePreferencesPatch(AppearancePreferencesPatch{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if out.ColorMode != nil || out.BoardTheme != nil || out.MessageLayout != nil || out.Density != nil || out.PersonaHeroPositions != nil {
		t.Errorf("nil fields mutated: %#v", out)
	}
}

// Each field validates against its own allow-list and reports an error named for
// that field; an unknown value must be rejected rather than silently persisted.
func TestNormalizeAppearancePreferencesPatch_RejectsInvalidPerField(t *testing.T) {
	cases := []struct {
		name  string
		patch AppearancePreferencesPatch
		field string
	}{
		{"color_mode", AppearancePreferencesPatch{ColorMode: strPtr("rainbow")}, "color_mode"},
		{"board_theme", AppearancePreferencesPatch{BoardTheme: strPtr("neon")}, "board_theme"},
		{"message_layout", AppearancePreferencesPatch{MessageLayout: strPtr("bubbles")}, "message_layout"},
		{"density", AppearancePreferencesPatch{Density: strPtr("cramped")}, "density"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := NormalizeAppearancePreferencesPatch(c.patch)
			if err == nil || !strings.Contains(err.Error(), c.field+" is invalid") {
				t.Errorf("invalid %s: got err %v, want %q", c.field, err, c.field+" is invalid")
			}
		})
	}
}

// AppearancePreferencesPatchEmpty is true only when every field is nil; setting
// any single field must flip it to false. Testing each field independently bites
// if a field is dropped from the conjunction.
func TestAppearancePreferencesPatchEmpty(t *testing.T) {
	if !AppearancePreferencesPatchEmpty(AppearancePreferencesPatch{}) {
		t.Errorf("all-nil patch reported non-empty")
	}
	nonEmpty := []struct {
		name  string
		patch AppearancePreferencesPatch
	}{
		{"ColorMode", AppearancePreferencesPatch{ColorMode: strPtr("")}},
		{"BoardTheme", AppearancePreferencesPatch{BoardTheme: strPtr("")}},
		{"MessageLayout", AppearancePreferencesPatch{MessageLayout: strPtr("")}},
		{"Density", AppearancePreferencesPatch{Density: strPtr("")}},
		{"PersonaHeroPositions", AppearancePreferencesPatch{PersonaHeroPositions: &map[string]PersonaHeroPosition{}}},
	}
	for _, c := range nonEmpty {
		if AppearancePreferencesPatchEmpty(c.patch) {
			t.Errorf("patch with %s set reported empty", c.name)
		}
	}
}

func deref(p *string) string {
	if p == nil {
		return "<nil>"
	}
	return *p
}

func TestNormalizePersonaHeroPositions(t *testing.T) {
	positions := map[string]PersonaHeroPosition{
		" bot-a ": {X: 23, Y: 78},
	}
	patch, err := NormalizeAppearancePreferencesPatch(AppearancePreferencesPatch{PersonaHeroPositions: &positions})
	if err != nil {
		t.Fatal(err)
	}
	if got := (*patch.PersonaHeroPositions)["bot-a"]; got.X != 23 || got.Y != 78 {
		t.Fatalf("position = %#v", got)
	}
	encoded, err := EncodePersonaHeroPositions(*patch.PersonaHeroPositions)
	if err != nil {
		t.Fatal(err)
	}
	if got := DecodePersonaHeroPositions(encoded)["bot-a"]; got.X != 23 || got.Y != 78 {
		t.Fatalf("round trip = %#v", got)
	}

	invalid := map[string]PersonaHeroPosition{"bot-a": {X: 101, Y: 50}}
	if _, err := NormalizeAppearancePreferencesPatch(AppearancePreferencesPatch{PersonaHeroPositions: &invalid}); err == nil {
		t.Fatal("expected out-of-range position to be rejected")
	}
}

func TestNormalizeBotShelfPatch(t *testing.T) {
	order := []string{" a ", "b", "a", "", "c"}
	limit := 4
	patch, err := NormalizeAppearancePreferencesPatch(AppearancePreferencesPatch{BotShelfOrder: &order, BotShelfLimit: &limit})
	if err != nil {
		t.Fatal(err)
	}
	if got := *patch.BotShelfOrder; len(got) != 3 || got[0] != "a" || got[1] != "b" || got[2] != "c" {
		t.Fatalf("order = %v", got)
	}
	if *patch.BotShelfLimit != 4 {
		t.Fatalf("limit = %d", *patch.BotShelfLimit)
	}
	bad := -1
	if _, err := NormalizeAppearancePreferencesPatch(AppearancePreferencesPatch{BotShelfLimit: &bad}); err == nil {
		t.Fatal("expected negative limit to be rejected")
	}
	if got := DecodeBotShelfOrder(EncodeBotShelfOrder([]string{"x", "y"})); len(got) != 2 || got[1] != "y" {
		t.Fatalf("round trip = %v", got)
	}
	if DecodeBotShelfOrder("") != nil {
		t.Fatal("empty should decode to nil")
	}
}
