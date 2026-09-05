export interface GraphQLDocument {
  operation?: 'query' | 'mutation' | 'subscription';
  operationName?: string;
  variables: string[];
  fields: string[];
}

/** Lightweight GraphQL operation parser for captured request bodies. */
export function parseGraphQL(source: string): GraphQLDocument {
  const text = source.trim();
  const operation = text
    .match(/^(query|mutation|subscription)\b/i)?.[1]
    ?.toLowerCase() as GraphQLDocument['operation'];
  const operationName = text.match(
    /^(?:query|mutation|subscription)\s+([_A-Za-z][_0-9A-Za-z]*)/,
  )?.[1];
  const variables = [...text.matchAll(/\$([_A-Za-z][_0-9A-Za-z]*)\s*:/g)].map((match) => match[1]);
  const body = text.replace(/#[^\n]*/g, '');
  const fields = [...body.matchAll(/\b([_A-Za-z][_0-9A-Za-z]*)\s*(?=[({])/g)]
    .map((match) => match[1])
    .filter((field) => !['query', 'mutation', 'subscription'].includes(field));
  return { operation, operationName, variables, fields: [...new Set(fields)] };
}
