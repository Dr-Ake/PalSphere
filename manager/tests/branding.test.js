'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { brandServerDescription, stripServerDescriptionBrand } = require('../lib/branding');

test('adds the PalSphere signature to a custom join message', () => {
  assert.equal(brandServerDescription('Welcome, explorers!'), 'Welcome, explorers! • Hosted by PalSphere');
});

test('normalizes old PalSphere signatures without duplicating branding', () => {
  assert.equal(brandServerDescription('Friends only • Managed by PalSphere'), 'Friends only • Hosted by PalSphere');
  assert.equal(brandServerDescription('Friends only - Powered by PalSphere'), 'Friends only • Hosted by PalSphere');
  assert.equal(brandServerDescription('Friends only • Hosted by PalSphere'), 'Friends only • Hosted by PalSphere');
});

test('keeps a hosting signature when the custom message is empty', () => {
  assert.equal(brandServerDescription(''), 'Hosted by PalSphere');
  assert.equal(stripServerDescriptionBrand('Hosted by PalSphere'), '');
});
