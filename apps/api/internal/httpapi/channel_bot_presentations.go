package httpapi

import (
	"errors"
	"net/http"
)

var errChannelBotPresentationsGone = errors.New("channel bot presentations are no longer supported")

func (s *Server) upsertChannelBotPresentation(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusGone, errChannelBotPresentationsGone)
}

func (s *Server) deleteChannelBotPresentation(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusGone, errChannelBotPresentationsGone)
}
