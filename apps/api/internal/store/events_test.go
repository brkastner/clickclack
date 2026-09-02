package store

import "testing"

func TestBotIdentityAndAssignmentEventsAreDurable(t *testing.T) {
	t.Parallel()
	for _, eventType := range []string{"bot.updated", "channel.bot_assignment_updated"} {
		if !IsDurableEventType(eventType) {
			t.Errorf("%q is not durable", eventType)
		}
	}
}
