using System;
using static System.Math;
using Alias = System.Text.StringBuilder;
global using System.Linq;

namespace Api.Auth;

public interface IJwtService
{
    string Issue(string sub);
}

public class JwtService : IJwtService
{
    private readonly string _secret;

    public JwtService(string secret)
    {
        _secret = secret;
    }

    public string Issue(string sub) => _secret + sub;

    public string Secret => _secret;

    public record Token(string Value);
}
