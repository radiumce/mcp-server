import { z, ZodSchema } from 'zod';
import logger from './logger.js';

abstract class SchemaValidator {
  protected abstract schema: ZodSchema;

  validate(data: any): any {
    const result = this.schema.safeParse(data);
    if (!result.success) {
      logger.error(`Schema validation failed: ${result.error.message}`);
      throw new Error(`Invalid parameters: ${result.error.message}`);
    }
    return result.data;
  }
}

export default SchemaValidator;
