import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import { standVerworfen } from './archivAbruf';

describe('standVerworfen', () => {
  it.each([403, 404, 409])('%i verwirft den Stand', (status) => {
    expect(standVerworfen(new ApiError(status, 'nein'))).toBe(true);
  });

  it.each([400, 500, 503])('%i lässt ihn als veraltet stehen', (status) => {
    expect(standVerworfen(new ApiError(status, 'nein'))).toBe(false);
  });

  it('ein Netzfehler lässt ihn stehen', () => {
    expect(standVerworfen(new TypeError('Failed to fetch'))).toBe(false);
  });
});
