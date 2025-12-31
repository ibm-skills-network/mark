import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('http://localhost:3010/author/1');
  
  // make changes to assignment preview content
  const editor = page.locator('.ql-editor').first();

  await editor.fill('');
  await page.getByText('In this project, you will').click();
  await page.locator('.ql-editor').first().press('ControlOrMeta+a');
  await page.locator('.ql-editor').first().fill('This assignment will test your knowledge on creating websites and testing your ability to code.');
  await page.getByText('Before submitting your').click();
  await page.locator('section:nth-child(2) > .w-full > .flex > .quill-editor > .ql-editor').press('ControlOrMeta+a');
  await page.locator('section:nth-child(2) > .w-full > .flex > .quill-editor > .ql-editor').fill('The instructions to successfully completing this assignment include answering all questions truthfully and correctly, and submitting the assignment before the deadline.');
  await page.getByText('The assignment is worth 10').click();
  await page.getByText('The assignment is worth 10 points and requires 60% to pass.[1] (1 point)').press('ControlOrMeta+a');
  await page.getByText('The assignment is worth 10 points and requires 60% to pass.[1] (1 point)').fill('Learners will be graded based on the criteria mentioned in the question, and it will mostly be about correctness with part marks being awarded for good effort.');
  
  // open preview and verify changes
  const page1Promise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Preview' }).click();
  const page1 = await page1Promise;

  // verify updated content in preview
  await page1.getByRole('heading', { name: 'About this assignment' }).click();
  await page1.getByText('This assignment will test').click();
  await page1.getByRole('heading', { name: 'Instructions' }).click();
  await expect(page1.getByRole('heading', { name: 'Instructions' })).toBeVisible();
  await page1.getByText('The instructions to').click();
  await page1.getByRole('heading', { name: 'Grading Criteria' }).click();
  await page1.getByText('Learners will be graded based').click();

});