import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fakeApi, renderApp } from './helpers';

describe('App routing', () => {
  it('redirects / to the schema list', async () => {
    renderApp(fakeApi(), '/');
    expect(await screen.findByRole('heading', { name: 'Schemas' })).toBeInTheDocument();
  });

  it('shows the brand and the main navigation', () => {
    renderApp(fakeApi(), '/schemas');
    expect(screen.getByText('CSV Validator')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Schemas' })).toHaveAttribute('aria-current', 'page');
  });

  it('shows a not-found message for unknown pages', () => {
    renderApp(fakeApi(), '/nowhere');
    expect(screen.getByText('Page not found.')).toBeInTheDocument();
  });
});
