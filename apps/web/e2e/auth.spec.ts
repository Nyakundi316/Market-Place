import {
  clearRateLimits,
  createProfile,
  mailLink,
  expect,
  signUp,
  test,
  uniqueEmail,
} from './support';

test.beforeEach(() => clearRateLimits());

test('sign up → onboarding → feed, then the profile is public', async ({ page }) => {
  const { email } = await signUp(page);
  const username = await createProfile(page, 'Amina Wanjiru');

  await page.getByLabel('Country').selectOption('KE');
  await page.getByLabel('City or town').fill('Nairobi');
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('heading', { name: 'Tell buyers about yourself' })).toBeVisible();
  await page.getByLabel('Bio').fill('Refurbished laptops, Nairobi CBD.');
  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(page).toHaveURL(/\/feed$/);

  await page.getByRole('button', { name: 'Account menu' }).first().click();
  await expect(page.getByRole('menu')).toContainText(email);

  const res = await page.request.get(`/api/users/${username}`);
  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({
    displayName: 'Amina Wanjiru',
    country: 'KE',
    city: 'Nairobi',
    bio: 'Refurbished laptops, Nairobi CBD.',
  });
});

test('onboarding rejects a taken username on the field', async ({ page, browser }) => {
  await signUp(page);
  const taken = await createProfile(page);

  const other = await browser.newPage();
  await signUp(other);
  await other.getByLabel('Display name').fill('Someone Else');
  await other.getByLabel('Username').fill(taken);
  await other.getByRole('button', { name: 'Continue' }).click();
  await expect(other.getByText('Taken')).toBeVisible();
  await other.close();
});

test('session survives a reload and log out ends it', async ({ page }) => {
  await signUp(page);
  await createProfile(page);
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await expect(page).toHaveURL(/\/feed$/);

  await page.reload();
  const menu = page.getByRole('button', { name: 'Account menu' }).first();
  await expect(menu).toBeVisible();

  await menu.click();
  await page.getByRole('menuitem', { name: 'Log out' }).click();
  await expect(page.getByRole('link', { name: 'Log in' }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole('link', { name: 'Log in' }).first()).toBeVisible();
});

test('protected pages bounce to login and come back after', async ({ page }) => {
  await page.goto('/onboarding');
  await expect(page).toHaveURL(/\/login\?next=%2Fonboarding/);
});

test('wrong password shows an error; the right one signs in', async ({ page }) => {
  const { email, password } = await signUp(page);
  await createProfile(page);
  await page.context().clearCookies();

  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('not the password');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('alert')).toBeVisible();

  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/feed$/);
});

test('email verification link confirms the address once', async ({ page }) => {
  const { email } = await signUp(page);
  const link = await mailLink(email, /confirm|verify/i);

  await page.goto(link);
  await expect(page.getByRole('heading', { name: 'Email confirmed' })).toBeVisible();

  await page.goto(link);
  await expect(page.getByRole('heading', { name: "We couldn't confirm that link" })).toBeVisible();
});

test('forgot → reset password → log in with the new one', async ({ page }) => {
  const { email } = await signUp(page);
  await page.context().clearCookies();

  await page.goto('/forgot-password');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible();

  await page.goto(await mailLink(email, /reset/i));
  await page.getByLabel('New password', { exact: true }).fill('a brand new phrase');
  await page.getByLabel('Confirm password', { exact: true }).fill('a brand new phrase');
  await page.getByRole('button', { name: 'Update password' }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('a brand new phrase');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/onboarding/); // no profile yet
});

test('signup validates on the client before calling the API', async ({ page }) => {
  await page.goto('/signup');
  await page.getByLabel('Email').fill(uniqueEmail('short'));
  await page.getByLabel('Password', { exact: true }).fill('short');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Password must be at least 8 characters')).toBeVisible();
  await expect(page).toHaveURL(/\/signup/);
});
