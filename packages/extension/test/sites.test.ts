import { describe, expect, it } from 'vitest';
import { hostOf, matchesSite, normalizeSite } from '../src/shared/sites.ts';

describe('hostOf', () => {
  it('returns the host of web pages only', () => {
    expect(hostOf('https://App.Example.com:8443/path?q=1')).toBe('app.example.com');
    expect(hostOf('http://127.0.0.1:3000/')).toBe('127.0.0.1');
    expect(hostOf('chrome://settings')).toBeNull();
    expect(hostOf('about:blank')).toBeNull();
    expect(hostOf('')).toBeNull();
  });
});

describe('matchesSite', () => {
  it('covers the host and its subdomains, nothing that merely ends the same', () => {
    expect(matchesSite('example.com', ['example.com'])).toBe(true);
    expect(matchesSite('mail.example.com', ['example.com'])).toBe(true);
    expect(matchesSite('badexample.com', ['example.com'])).toBe(false);
    expect(matchesSite('example.com', ['mail.example.com'])).toBe(false);
    expect(matchesSite('example.com', [])).toBe(false);
  });
});

describe('normalizeSite', () => {
  it('accepts a bare host or a full URL', () => {
    expect(normalizeSite(' Example.com ')).toBe('example.com');
    expect(normalizeSite('https://bank.example/login')).toBe('bank.example');
    expect(normalizeSite('localhost:3000')).toBe('localhost');
  });

  it('rejects what is not a site', () => {
    expect(normalizeSite('')).toBeNull();
    expect(normalizeSite('   ')).toBeNull();
    expect(normalizeSite('chrome://settings')).toBeNull();
  });
});
