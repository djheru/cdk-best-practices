/* eslint-disable @typescript-eslint/no-var-requires */
// https://github.com/cypress-io/cypress/issues/22059
import { describe, expect, it } from '@jest/globals';

import Ajv from 'ajv';
import { environments } from './config';

const ajv = new Ajv({ strict: false });

describe('feature flag configuration', () => {
  describe('feature stage i.e. ephemeral', () => {
    it('should match the snapshot', () => {
      expect(environments.feature).toMatchSnapshot();
    });

    it('should validate with the schema', () => {
      const { schema } = require('./config.schema');
      expect(ajv.validate(schema, environments.feature)).toEqual(true);
    });
  });

  describe('dev stage', () => {
    it('should match the snapshot', () => {
      expect(environments.dev).toMatchSnapshot();
    });

    it('should validate with the schema', () => {
      const { schema } = require('./config.schema');
      expect(ajv.validate(schema, environments.dev)).toEqual(true);
    });
  });

  describe('staging stage', () => {
    it('should match the snapshot', () => {
      expect(environments.staging).toMatchSnapshot();
    });

    it('should validate with the schema', () => {
      const { schema } = require('./config.schema');
      expect(ajv.validate(schema, environments.staging)).toEqual(true);
    });
  });

  describe('prod stage', () => {
    it('should match the snapshot', () => {
      expect(environments.prod).toMatchSnapshot();
    });

    it('should validate with the schema', () => {
      const { schema } = require('./config.schema');
      expect(ajv.validate(schema, environments.prod)).toEqual(true);
    });
  });
});
