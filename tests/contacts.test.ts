import test from 'node:test';
import assert from 'node:assert/strict';
import { websiteUrl, telephoneUrl } from '../src/domain/contacts';

test('website links accept http/https and normalize an explicitly entered bare domain', () => {
  assert.equal(websiteUrl('  charity.example  '), 'https://charity.example/');
  assert.equal(websiteUrl('www.charity.example/shops?area=one#hours'), 'https://www.charity.example/shops?area=one#hours');
  assert.equal(websiteUrl('HTTP://CHARITY.EXAMPLE/contact'), 'http://charity.example/contact');
  assert.equal(websiteUrl('https://charity.example:8443/contact'), 'https://charity.example:8443/contact');
  assert.equal(websiteUrl('bücher.example'), 'https://xn--bcher-kva.example/');
});

test('website links reject unsupported schemes, credentials, malformed hosts and executable text', () => {
  for (const invalid of [undefined, null, 123, '', '   ', 'javascript:alert(1)', 'data:text/html,test', 'file:///C:/file', 'ftp://charity.example', '//charity.example', 'https:charity.example', 'https://user:password@charity.example', 'person@charity.example', 'https://', 'charity', 'charity..example', 'https://charity.example\\else', 'https://charity.example/a b', 'https://charity.example/\ninjected']) {
    assert.equal(websiteUrl(invalid), '', String(invalid));
  }
});

test('telephone links preserve the leading zero or plus without inferring a country', () => {
  assert.equal(telephoneUrl('01632 960123'), 'tel:01632960123');
  assert.equal(telephoneUrl(' +44 (1632) 960-123 '), 'tel:+441632960123');
  assert.equal(telephoneUrl('01632.960.123'), 'tel:01632960123');
  assert.equal(telephoneUrl('001632 960123'), 'tel:001632960123');
  assert.equal(telephoneUrl('1234'), 'tel:1234');
});

test('telephone links handle an explicitly supplied extension and refuse ambiguous or active content', () => {
  assert.equal(telephoneUrl('01632 960123 ext. 42'), 'tel:01632960123;ext=42');
  assert.equal(telephoneUrl('+44 1632 960123 x007'), 'tel:+441632960123;ext=007');
  assert.equal(telephoneUrl('01632 960123;ext=42'), 'tel:01632960123;ext=42');
  for (const invalid of [undefined, null, 1632960123, '', '++441632', '01632 / 0123', 'Call reception', 'tel:01632960123', '01632;foo=1', '*123#', '123\n456', '01632@example.org', '123 ext. code']) {
    assert.equal(telephoneUrl(invalid), '', String(invalid));
  }
});
