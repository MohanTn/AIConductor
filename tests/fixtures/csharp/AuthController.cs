using System;
using Api.Auth;

namespace Api.Controllers
{
    public class AuthController
    {
        private readonly IJwtService _jwt;

        public AuthController(IJwtService jwt)
        {
            _jwt = jwt;
        }

        public string Refresh(string token)
        {
            return _jwt.Issue(token);
        }
    }

    public enum Grant
    {
        Password,
        RefreshToken,
    }
}
