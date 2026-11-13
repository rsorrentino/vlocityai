const orgAuth = require('../../services/salesforceOrgAuthService');

function jsonResponse(status, body) {
  return { status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(body) };
}

describe('salesforceOrgAuthService', () => {
  describe('normalizeLoginUrl', () => {
    it.each([
      [undefined, 'https://login.salesforce.com'],
      ['https://test.salesforce.com/', 'https://test.salesforce.com'],
      ['https://acme--uat.sandbox.my.salesforce.com/some/path', 'https://acme--uat.sandbox.my.salesforce.com'],
    ])('accepts %p', (input, expected) => {
      expect(orgAuth.normalizeLoginUrl(input)).toBe(expected);
    });

    it.each([
      'http://login.salesforce.com',
      'https://evil.example.com',
      'https://salesforce.com.evil.example',
      'https://169.254.169.254',
      'not a url',
    ])('rejects %p', (input) => {
      expect(() => orgAuth.normalizeLoginUrl(input)).toThrow();
    });
  });

  describe('device flow', () => {
    it('starts with the Salesforce CLI connected app', async () => {
      const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(200, {
        device_code: 'dc', user_code: 'ABCD1234', verification_uri: 'https://login.salesforce.com/setup/connect', interval: 5,
      }));
      const flow = await orgAuth.startDeviceFlow({ loginUrl: 'https://test.salesforce.com', fetchImpl });
      expect(flow).toMatchObject({ deviceCode: 'dc', userCode: 'ABCD1234', interval: 5, loginUrl: 'https://test.salesforce.com' });
      const [url, init] = fetchImpl.mock.calls[0];
      expect(url).toBe('https://test.salesforce.com/services/oauth2/token');
      const params = new URLSearchParams(init.body);
      expect(params.get('response_type')).toBe('device_code');
      expect(params.get('client_id')).toBe('PlatformCLI');
      expect(params.get('scope')).toContain('refresh_token');
    });

    it.each([
      [{ error: 'authorization_pending' }, 'pending'],
      [{ error: 'slow_down' }, 'slow_down'],
      [{ error: 'access_denied' }, 'denied'],
      [{ error: 'invalid_grant' }, 'expired'],
      [{ error: 'something_else', error_description: 'boom' }, 'error'],
    ])('maps %p to %s', async (body, status) => {
      const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(400, body));
      const result = await orgAuth.pollDeviceFlow({ loginUrl: undefined, deviceCode: 'dc', fetchImpl });
      expect(result.status).toBe(status);
    });

    it('returns the refresh token and instance URL when approved', async () => {
      const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(200, {
        access_token: 'at', refresh_token: 'rt', instance_url: 'https://acme.my.salesforce.com',
      }));
      const result = await orgAuth.pollDeviceFlow({ deviceCode: 'dc', fetchImpl });
      expect(result).toEqual({ status: 'complete', tokens: { refreshToken: 'rt', instanceUrl: 'https://acme.my.salesforce.com' } });
      expect(new URLSearchParams(fetchImpl.mock.calls[0][1].body).get('grant_type')).toBe('device');
    });

    it('fails clearly when no refresh token is returned', async () => {
      const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(200, { access_token: 'at', instance_url: 'https://x.my.salesforce.com' }));
      const result = await orgAuth.pollDeviceFlow({ deviceCode: 'dc', fetchImpl });
      expect(result.status).toBe('error');
      expect(result.message).toMatch(/refresh token/);
    });
  });

  describe('SFDX auth URLs', () => {
    it('builds a URL the Salesforce CLI accepts', () => {
      expect(orgAuth.buildSfdxAuthUrl({ refreshToken: '5Aep861abc', instanceUrl: 'https://acme.my.salesforce.com' }))
        .toBe('force://PlatformCLI::5Aep861abc@acme.my.salesforce.com');
    });

    it.each([
      'force://PlatformCLI::5Aep861abc@acme.my.salesforce.com',
      'force://3MVG9abc:SECRET:5Aep861abc@acme--uat.sandbox.my.salesforce.com',
    ])('accepts %p', (url) => {
      expect(orgAuth.validateSfdxAuthUrl(url)).toBe(url);
    });

    it.each([
      'https://acme.my.salesforce.com',
      'force://PlatformCLI::token@host; rm -rf /',
      'force://a:b:c@host\n--target-org x',
      '',
    ])('rejects %p', (url) => {
      expect(() => orgAuth.validateSfdxAuthUrl(url)).toThrow(/Not a valid SFDX auth URL/);
    });
  });
});
