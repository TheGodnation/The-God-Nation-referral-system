import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RegisterPage } from '../pages/RegisterPage';

describe('RegisterPage', () => {
  it('shows the exact required WhatsApp registration prompt', () => {
    render(
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>,
    );

    expect(
      screen.getByText(
        'Please enter the WhatsApp number you will use to join the Training Community. This will help us identify and recognize your registration.',
      ),
    ).toBeInTheDocument();
  });
});
