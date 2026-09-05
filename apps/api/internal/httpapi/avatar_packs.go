package httpapi

import (
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
)

const avatarPackFileLimit = 1000

func validAvatarName(name string) bool {
	return name != "" && !strings.ContainsAny(name, "/\\\x00") && !strings.Contains(name, "..")
}

func validAvatarPack(name string) bool {
	return name == strings.TrimSpace(name) && validAvatarName(name) && utf8.RuneCountInString(name) <= 128
}

func avatarContentType(name string) string {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".avif":
		return "image/avif"
	}
	return ""
}

func (s *Server) authorizeAvatarPacks(w http.ResponseWriter, r *http.Request) bool {
	act, err := s.currentActor(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err)
		return false
	}
	if err := act.requireScope("messages:read"); err != nil {
		writeError(w, http.StatusForbidden, err)
		return false
	}
	return true
}

func (s *Server) listAvatarPacks(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeAvatarPacks(w, r) {
		return
	}
	packs := []string{}
	if root, err := os.OpenRoot(s.avatarPacksDir); err == nil {
		// Read-only handles have no buffered writes to flush.
		defer func() { _ = root.Close() }()
		entries, err := fs.ReadDir(root.FS(), ".")
		if err == nil {
			for _, entry := range entries {
				if entry.IsDir() && validAvatarPack(entry.Name()) {
					packs = append(packs, entry.Name())
				}
			}
		}
	}
	sort.Strings(packs)
	writeJSON(w, http.StatusOK, map[string]any{"packs": packs, "directory": s.avatarPacksDir})
}

// os.Root enforces containment at open time, including concurrent symlink changes.
func (s *Server) avatarFiles(pack string) []string {
	files := []string{}
	root, err := os.OpenRoot(s.avatarPacksDir)
	if err != nil {
		return files
	}
	// Read-only handles have no buffered writes to flush.
	defer func() { _ = root.Close() }()
	entries, err := fs.ReadDir(root.FS(), pack)
	if err != nil {
		return files
	}
	for _, entry := range entries {
		name := entry.Name()
		if !validAvatarName(name) || avatarContentType(name) == "" {
			continue
		}
		info, err := root.Stat(filepath.Join(pack, name))
		if err != nil || !info.Mode().IsRegular() {
			continue
		}
		files = append(files, name)
	}
	sort.Strings(files)
	if len(files) > avatarPackFileLimit {
		files = files[:avatarPackFileLimit]
	}
	for i, name := range files {
		files[i] = "/api/avatar-packs/" + url.PathEscape(pack) + "/" + url.PathEscape(name)
	}
	return files
}

func (s *Server) listAvatarPackFiles(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeAvatarPacks(w, r) {
		return
	}
	pack := avatarPathParam(r, "pack")
	if !validAvatarPack(pack) {
		http.NotFound(w, r)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"files": s.avatarFiles(pack)})
}

func (s *Server) getAvatarPackFile(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeAvatarPacks(w, r) {
		return
	}
	pack, name := avatarPathParam(r, "pack"), avatarPathParam(r, "file")
	contentType := avatarContentType(name)
	if !validAvatarPack(pack) || !validAvatarName(name) || contentType == "" {
		http.NotFound(w, r)
		return
	}
	root, err := os.OpenRoot(s.avatarPacksDir)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	// Read-only handles have no buffered writes to flush.
	defer func() { _ = root.Close() }()
	info, err := root.Stat(filepath.Join(pack, name))
	if err != nil || !info.Mode().IsRegular() {
		http.NotFound(w, r)
		return
	}
	file, err := root.Open(filepath.Join(pack, name))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer func() { _ = file.Close() }()
	info, err = file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, no-cache")
	http.ServeContent(w, r, name, info.ModTime(), file)
}

// Chi matches RawPath when present; otherwise its parameters are already decoded.
func avatarPathParam(r *http.Request, name string) string {
	value := chi.URLParam(r, name)
	if r.URL.RawPath != "" {
		decoded, err := url.PathUnescape(value)
		if err != nil {
			return ""
		}
		return decoded
	}
	return value
}
