package auth

import (
	"crypto/sha256"
	"encoding/hex"

	"github.com/example/api/internal/tokens"
)

type RefreshResult struct {
	Token     string
	ExpiresAt int64
}

type AuthService struct {
	helper *tokens.JwtHelper
}

func NewAuthService(helper *tokens.JwtHelper) *AuthService {
	return &AuthService{helper: helper}
}

func (s *AuthService) Refresh(token string) (string, error) {
	return s.helper.Rotate(token)
}

func RotateRefreshToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}
