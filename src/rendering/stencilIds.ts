let idCounter = 0;

export function nanoid(): string {
  idCounter += 1;
  return `stencil-${idCounter}`;
}
