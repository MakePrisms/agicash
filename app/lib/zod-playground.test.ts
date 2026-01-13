import { describe, expect, it } from 'bun:test';
import { z } from 'zod';

describe('Zod Playground', () => {
  describe('basic types', () => {
    it('validates strings', () => {
      const schema = z.string();

      expect(schema.parse('hello')).toBe('hello');
      expect(() => schema.parse(123)).toThrow();
    });

    it('validates numbers', () => {
      const schema = z.number();

      expect(schema.parse(42)).toBe(42);
      expect(() => schema.parse('42')).toThrow();
    });

    it('validates booleans', () => {
      const schema = z.boolean();

      expect(schema.parse(true)).toBe(true);
      expect(() => schema.parse('true')).toThrow();
    });
  });

  describe('string refinements', () => {
    it('validates email', () => {
      const schema = z.string().email();

      expect(schema.parse('test@example.com')).toBe('test@example.com');
      expect(() => schema.parse('not-an-email')).toThrow();
    });

    it('validates min/max length', () => {
      const schema = z.string().min(3).max(10);

      expect(schema.parse('hello')).toBe('hello');
      expect(() => schema.parse('hi')).toThrow();
      expect(() => schema.parse('this is too long')).toThrow();
    });

    it('validates with regex', () => {
      const schema = z.string().regex(/^[A-Z]{3}$/);

      expect(schema.parse('ABC')).toBe('ABC');
      expect(() => schema.parse('abc')).toThrow();
    });
  });

  describe('objects', () => {
    it('validates object shape', () => {
      const userSchema = z.object({
        name: z.string(),
        age: z.number(),
        email: z.string().email(),
      });

      const validUser = { name: 'John', age: 30, email: 'john@example.com' };
      expect(userSchema.parse(validUser)).toEqual(validUser);

      // Missing field
      expect(() => userSchema.parse({ name: 'John' })).toThrow();
    });

    it('handles optional fields', () => {
      const schema = z.object({
        required: z.string(),
        optional: z.string().optional(),
      });

      expect(schema.parse({ required: 'hello' })).toEqual({
        required: 'hello',
      });
      expect(schema.parse({ required: 'hello', optional: 'world' })).toEqual({
        required: 'hello',
        optional: 'world',
      });
    });

    it('handles default values', () => {
      const schema = z.object({
        name: z.string(),
        role: z.string().default('user'),
      });

      expect(schema.parse({ name: 'John' })).toEqual({
        name: 'John',
        role: 'user',
      });
    });
  });

  describe('arrays', () => {
    it('validates arrays', () => {
      const schema = z.array(z.string());

      expect(schema.parse(['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
      expect(() => schema.parse([1, 2, 3])).toThrow();
    });

    it('validates array length', () => {
      const schema = z.array(z.number()).min(2).max(5);

      expect(schema.parse([1, 2, 3])).toEqual([1, 2, 3]);
      expect(() => schema.parse([1])).toThrow();
    });
  });

  describe('unions and enums', () => {
    it('validates unions', () => {
      const schema = z.union([z.string(), z.number()]);

      expect(schema.parse('hello')).toBe('hello');
      expect(schema.parse(42)).toBe(42);
      expect(() => schema.parse(true)).toThrow();
    });

    it('validates enums', () => {
      const StatusSchema = z.enum(['pending', 'active', 'completed']);

      expect(StatusSchema.parse('active')).toBe('active');
      expect(() => StatusSchema.parse('invalid')).toThrow();

      // Get enum values
      expect(StatusSchema.options).toEqual(['pending', 'active', 'completed']);
    });

    it('validates discriminated unions', () => {
      const schema = z.discriminatedUnion('type', [
        z.object({ type: z.literal('text'), content: z.string() }),
        z.object({ type: z.literal('image'), url: z.string().url() }),
      ]);

      expect(schema.parse({ type: 'text', content: 'hello' })).toEqual({
        type: 'text',
        content: 'hello',
      });
      expect(
        schema.parse({ type: 'image', url: 'https://example.com/img.png' }),
      ).toEqual({
        type: 'image',
        url: 'https://example.com/img.png',
      });
    });
  });

  describe('transformations', () => {
    it('transforms values', () => {
      const schema = z.string().transform((val) => val.toUpperCase());

      expect(schema.parse('hello')).toBe('HELLO');
    });

    it('coerces types', () => {
      const numberSchema = z.coerce.number();
      const dateSchema = z.coerce.date();

      expect(numberSchema.parse('42')).toBe(42);
      expect(dateSchema.parse('2024-01-01')).toBeInstanceOf(Date);
    });
  });

  describe('safeParse (non-throwing)', () => {
    it('returns success result', () => {
      const schema = z.string();
      const result = schema.safeParse('hello');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('hello');
      }
    });

    it('returns error result', () => {
      const schema = z.string();
      const result = schema.safeParse(123);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.length).toBeGreaterThan(0);
      }
    });
  });

  describe('type inference', () => {
    it('infers types from schemas', () => {
      const userSchema = z.object({
        id: z.number(),
        name: z.string(),
        email: z.string().email(),
        role: z.enum(['admin', 'user']),
      });

      // This is how you extract the TypeScript type from a schema
      type User = z.infer<typeof userSchema>;

      // The inferred type is equivalent to:
      // type User = {
      //   id: number;
      //   name: string;
      //   email: string;
      //   role: 'admin' | 'user';
      // }

      const user: User = {
        id: 1,
        name: 'John',
        email: 'john@example.com',
        role: 'admin',
      };

      expect(userSchema.parse(user)).toEqual(user);
    });
  });

  describe('custom refinements', () => {
    it('adds custom validation logic', () => {
      const passwordSchema = z
        .string()
        .min(8)
        .refine((val) => /[A-Z]/.test(val), {
          message: 'Password must contain uppercase letter',
        })
        .refine((val) => /[0-9]/.test(val), {
          message: 'Password must contain a number',
        });

      expect(passwordSchema.parse('Password1')).toBe('Password1');
      expect(() => passwordSchema.parse('password1')).toThrow(); // no uppercase
    });

    it('validates across multiple fields with superRefine', () => {
      const formSchema = z
        .object({
          password: z.string().min(8),
          confirmPassword: z.string(),
        })
        .superRefine((data, ctx) => {
          if (data.password !== data.confirmPassword) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'Passwords do not match',
              path: ['confirmPassword'],
            });
          }
        });

      expect(
        formSchema.parse({
          password: 'secret123',
          confirmPassword: 'secret123',
        }),
      ).toEqual({
        password: 'secret123',
        confirmPassword: 'secret123',
      });

      expect(() =>
        formSchema.parse({
          password: 'secret123',
          confirmPassword: 'different',
        }),
      ).toThrow();
    });
  });

  describe('nullable and nullish', () => {
    it('handles nullable', () => {
      const schema = z.string().nullable();

      expect(schema.parse('hello')).toBe('hello');
      expect(schema.parse(null)).toBe(null);
      expect(() => schema.parse(undefined)).toThrow();
    });

    it('handles nullish (null or undefined)', () => {
      const schema = z.string().nullish();

      expect(schema.parse('hello')).toBe('hello');
      expect(schema.parse(null)).toBe(null);
      expect(schema.parse(undefined)).toBeUndefined();
    });
  });

  describe('my playground', () => {
    it('should not propagate extra fields', () => {
      const person = z.object({
        type: z.literal('person'),
        name: z.string(),
        age: z.number(),
        email: z.email().nullable(),
      });

      const animal = z.object({
        type: z.literal('animal'),
        name: z.string(),
        species: z.string(),
      });

      const personOrAnimal = z.union([person, animal]);

      const x = personOrAnimal.parse({
        type: 'person',
        name: 'John',
        age: 30,
        email: 'john@example.com',
        species: undefined,
        something: 'random',
      });

      console.log('x: ', x);

      expect(x).toEqual({
        type: 'person',
        name: 'John',
        age: 30,
        email: 'john@example.com',
      });

      const y = personOrAnimal.parse({
        type: 'animal',
        name: 'Boby',
        age: null,
        email: undefined,
        species: 'dog',
        something: 'random2',
      });

      console.log('y: ', y);

      expect(y).toEqual({
        type: 'animal',
        name: 'Boby',
        species: 'dog',
      });

      expect(() =>
        personOrAnimal.parse({
          type: 'animal',
          name: 'John',
          age: 30,
          email: 'john@example.com',
          species: undefined,
        }),
      ).toThrow();
    });
  });
});
