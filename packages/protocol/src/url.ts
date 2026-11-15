import { z } from 'zod';

/** A web address. Anything else (javascript:, file:, browser pages) is refused. */
export const httpUrl = z.string().refine(
  (value) => {
    try {
      return ['http:', 'https:'].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  },
  { error: 'Must be an http(s) URL' },
);
