import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemberMapTab } from '../components/admin/MemberMapTab';

const calls: { url: string; method: string; body: any }[] = [];

const MAP = {
  total: 6,
  withoutLocation: 2,
  countries: [
    {
      name: 'Cameroon',
      count: 5,
      children: [
        {
          name: 'Centre',
          count: 3,
          children: [
            {
              name: 'Mfoundi',
              count: 3,
              children: [{ name: 'Yaoundé III', count: 3, children: [{ name: 'Efoulan', count: 2, children: [] }, { name: 'Obili', count: 1, children: [] }] }],
            },
          ],
        },
        { name: 'Littoral', count: 2, children: [] },
      ],
    },
    { name: 'Nigeria', count: 1, children: [{ name: 'Lagos', count: 1, children: [] }] },
  ],
};

function mockFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      calls.push({ url, method, body });
      let resBody: unknown = { error: 'not found' };
      let status = 404;
      if (url.startsWith('/api/admin/location-map')) [status, resBody] = [200, MAP];
      else if (url.startsWith('/api/admin/communities?search=')) [status, resBody] = [200, { items: [{ id: 'hq', name: 'Headquarters' }] }];
      else if (url === '/api/admin/communities' && method === 'POST') [status, resBody] = [201, { id: 'new' }];
      return Promise.resolve({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => resBody });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  calls.length = 0;
});

describe('MemberMapTab', () => {
  it('shows totals and the Cameroon regions', async () => {
    mockFetch();
    render(<MemberMapTab includeTestData={false} />);
    expect(await screen.findByText('Members with a location')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.getByText('2 people have not given a location yet.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Regions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Centre\s*3/ })).toBeInTheDocument();
  });

  it('goes down from region to quarter', async () => {
    mockFetch();
    render(<MemberMapTab includeTestData={false} />);
    fireEvent.click(await screen.findByRole('button', { name: /Centre\s*3/ }));
    expect(screen.getByRole('heading', { name: 'Divisions' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Mfoundi\s*3/ }));
    fireEvent.click(screen.getByRole('button', { name: /Yaoundé III\s*3/ }));
    expect(screen.getByRole('heading', { name: 'Quarters' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Efoulan\s*2/ })).toBeInTheDocument();
  });

  it('creates a group tagged with the chosen region', async () => {
    mockFetch();
    render(<MemberMapTab includeTestData={false} />);
    fireEvent.click(await screen.findByRole('button', { name: /Centre\s*3/ }));
    fireEvent.click(screen.getByRole('button', { name: /Create a group here/ }));
    expect(screen.getByLabelText('Group name')).toHaveValue('Centre group');

    fireEvent.change(screen.getByPlaceholderText('Search groups by name'), { target: { value: 'Head' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByText('Headquarters', { selector: 'option' });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'hq' } });
    fireEvent.click(screen.getByRole('button', { name: 'Choose' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create group' }));

    await screen.findByText('Group "Centre group" created for Centre.');
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      name: 'Centre group',
      parentId: 'hq',
      placementCountry: 'Cameroon',
      placementRegion: 'Centre',
    });
  });

  it('shows countries and cities in the world view', async () => {
    mockFetch();
    render(<MemberMapTab includeTestData={false} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Whole world' }));
    expect(screen.getByRole('heading', { name: 'Countries' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Nigeria\s*1/ }));
    expect(screen.getByRole('heading', { name: 'Cities' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /Create a group here/ })).toBeInTheDocument());
  });
});
