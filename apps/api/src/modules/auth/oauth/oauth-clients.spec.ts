import { createHash } from 'node:crypto';
import { GitHubClient, GoogleClient } from './oauth-clients';

const creds = {
  clientId: 'cid',
  clientSecret: 'secret',
  redirectUri: 'http://localhost:3000/api/cb',
};

function mockFetch(responses: Record<string, unknown>) {
  return jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    // longest prefix wins, so /user and /user/emails don't collide
    const key = Object.keys(responses)
      .filter((k) => url.startsWith(k))
      .sort((a, b) => b.length - a.length)[0];
    if (!key) throw new Error(`unexpected fetch ${url}`);
    return new Response(JSON.stringify(responses[key]), { status: 200 });
  });
}

afterEach(() => jest.restoreAllMocks());

describe('GoogleClient', () => {
  it('builds an S256 PKCE authorization URL', () => {
    const url = new GoogleClient(creds).authorizationUrl('st', 'verifier-123');
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('code_challenge')).toBe(
      createHash('sha256').update('verifier-123').digest('base64url'),
    );
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('redirect_uri')).toBe(creds.redirectUri);
  });

  it('maps userinfo, honouring email_verified', async () => {
    const fetchSpy = mockFetch({
      'https://oauth2.googleapis.com/token': { access_token: 'at' },
      'https://openidconnect.googleapis.com/v1/userinfo': {
        sub: '42',
        email: 'a@gmail.com',
        email_verified: false,
        name: 'A',
      },
    });
    const id = await new GoogleClient(creds).exchange('code', 'verifier-123');
    expect(id).toEqual({
      providerUid: '42',
      email: 'a@gmail.com',
      emailVerified: false,
      name: 'A',
      avatarUrl: null,
    });
    expect(String(fetchSpy.mock.calls[0]![1]!.body)).toContain('code_verifier=verifier-123');
  });

  it('throws when the token exchange returns an error', async () => {
    mockFetch({ 'https://oauth2.googleapis.com/token': { error: 'invalid_grant' } });
    await expect(new GoogleClient(creds).exchange('bad', 'v')).rejects.toThrow('invalid_grant');
  });
});

describe('GitHubClient', () => {
  const base = {
    'https://github.com/login/oauth/access_token': { access_token: 'at' },
    'https://api.github.com/user': {
      id: 7,
      login: 'octo',
      name: null,
      avatar_url: 'https://x/a.png',
    },
  };

  it('uses only the verified primary email', async () => {
    mockFetch({
      ...base,
      'https://api.github.com/user/emails': [
        { email: 'public@x.com', primary: false, verified: true },
        { email: 'primary@x.com', primary: true, verified: true },
      ],
    });
    expect(await new GitHubClient(creds).exchange('code')).toMatchObject({
      providerUid: '7',
      email: 'primary@x.com',
      emailVerified: true,
      name: 'octo',
    });
  });

  it('reports no verified email when the primary is unverified', async () => {
    mockFetch({
      'https://api.github.com/user/emails': [{ email: 'p@x.com', primary: true, verified: false }],
      ...base,
    });
    expect(await new GitHubClient(creds).exchange('code')).toMatchObject({
      email: null,
      emailVerified: false,
    });
  });
});
