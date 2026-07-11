'use strict';

const SERVER_DESCRIPTION_SUFFIX = 'Hosted by PalSphere';
const SERVER_DESCRIPTION_SUFFIXES = Object.freeze([
  SERVER_DESCRIPTION_SUFFIX,
  'Powered by PalSphere',
  'Managed by PalSphere',
  'Managed by PalSphere Server Studio',
]);

function stripServerDescriptionBrand(value) {
  let description = String(value ?? '').trim();
  const lower = description.toLowerCase();
  const suffix = SERVER_DESCRIPTION_SUFFIXES.find((candidate) => lower.endsWith(candidate.toLowerCase()));
  if (!suffix) return description;
  description = description.slice(0, -suffix.length).replace(/\s*[|•—–-]\s*$/, '').trim();
  return description;
}

function brandServerDescription(value) {
  const customMessage = stripServerDescriptionBrand(value);
  return customMessage ? `${customMessage} • ${SERVER_DESCRIPTION_SUFFIX}` : SERVER_DESCRIPTION_SUFFIX;
}

module.exports = {
  SERVER_DESCRIPTION_SUFFIX,
  SERVER_DESCRIPTION_SUFFIXES,
  brandServerDescription,
  stripServerDescriptionBrand,
};
