package notepad

import (
	"errors"
	"strings"
	"sync"
)

const (
	maxPublishedMarkdownBytes = 64 << 10
	maxPublishedSteps         = 50
	maxPublishedStepBytes     = 500
)

// PublishedStore holds agent-authored notepad snapshots for conversation-scoped
// bridges such as pi-clickclack. Snapshots are intentionally ephemeral: the
// producing agent remains the source of truth and republishes after reconnect.
type PublishedStore struct {
	mu       sync.RWMutex
	entries  map[string]*Card
	watchers map[string]map[chan struct{}]struct{}
}

func NewPublishedStore() *PublishedStore {
	return &PublishedStore{
		entries:  make(map[string]*Card),
		watchers: make(map[string]map[chan struct{}]struct{}),
	}
}

func ValidatePublishedCard(card *Card) error {
	if card == nil {
		return nil
	}
	if card.Revision < 1 || card.UpdatedAt < 1 {
		return errors.New("notepad revision and updatedAt must be positive")
	}
	if card.Markdown != nil && len(*card.Markdown) > maxPublishedMarkdownBytes {
		return errors.New("notepad markdown is too large")
	}
	if len(card.Steps) > maxPublishedSteps {
		return errors.New("notepad has too many steps")
	}
	for _, step := range card.Steps {
		if strings.TrimSpace(step.Step) == "" || len(step.Step) > maxPublishedStepBytes {
			return errors.New("notepad step is empty or too large")
		}
		switch step.Status {
		case "pending", "in_progress", "completed":
		default:
			return errors.New("notepad step has an invalid status")
		}
	}
	return nil
}

func cloneCard(card *Card) *Card {
	if card == nil {
		return nil
	}
	copy := *card
	if card.Markdown != nil {
		markdown := *card.Markdown
		copy.Markdown = &markdown
	}
	copy.Steps = append([]Step(nil), card.Steps...)
	return &copy
}

func (s *PublishedStore) Get(key string) (*Card, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	card, ok := s.entries[key]
	return cloneCard(card), ok
}

func (s *PublishedStore) Put(key string, card *Card) {
	s.mu.Lock()
	s.entries[key] = cloneCard(card)
	watchers := make([]chan struct{}, 0, len(s.watchers[key]))
	for watcher := range s.watchers[key] {
		watchers = append(watchers, watcher)
	}
	s.mu.Unlock()
	for _, watcher := range watchers {
		select {
		case watcher <- struct{}{}:
		default:
		}
	}
}

// Watch atomically reports whether a publisher owns the target and subscribes
// to later invalidations. The cancel function is always safe to call.
func (s *PublishedStore) Watch(key string) (<-chan struct{}, bool, func()) {
	changes := make(chan struct{}, 1)
	s.mu.Lock()
	_, exists := s.entries[key]
	if exists {
		if s.watchers[key] == nil {
			s.watchers[key] = make(map[chan struct{}]struct{})
		}
		s.watchers[key][changes] = struct{}{}
	}
	s.mu.Unlock()
	cancel := func() {
		s.mu.Lock()
		if watchers := s.watchers[key]; watchers != nil {
			delete(watchers, changes)
			if len(watchers) == 0 {
				delete(s.watchers, key)
			}
		}
		s.mu.Unlock()
	}
	return changes, exists, cancel
}
