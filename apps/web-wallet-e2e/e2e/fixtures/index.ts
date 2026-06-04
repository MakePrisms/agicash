import { mergeTests } from '@playwright/test';
import { test as authTest } from './auth-fixture';
import { test as openSecretTest } from './open-secret/fixture';
import { test as passwordGeneratorTest } from './password-generator-fixture';

// If you want to add a new fixture just add it as additional argument to mergeTests below
export const test = mergeTests(openSecretTest, authTest, passwordGeneratorTest);

export { expect } from '@playwright/test';
