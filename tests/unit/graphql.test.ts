import { expect, it } from 'vitest';
import { parseGraphQL } from '../../src/core/graphql';

it('extracts GraphQL operation metadata', () => {
  expect(parseGraphQL('query GetUser($id: ID!) { user(id: $id) { name } }')).toMatchObject({
    operation: 'query',
    operationName: 'GetUser',
    variables: ['id'],
  });
});
