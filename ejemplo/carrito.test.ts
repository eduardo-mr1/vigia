/**
 * Suite de ejemplo con los defectos que Vigía detecta.
 *
 * Los seis pasan en verde en Jest. Ninguno verifica nada.
 */

describe('carrito', () => {
  it('calcula el total', () => {
    const total = sumar([10, 20]);
    // Falta el expect: la prueba pasa aunque sumar() devuelva basura.
  });

  it('aplica el descuento', () => {
    expect(aplicarDescuento(100, 10));
  });

  it('el carrito existe', () => {
    expect(true).toBe(true);
  });

  it.skip('valida el cupón vencido', () => {
    expect(validarCupon('VENCIDO')).toBe(false);
  });

  it.only('suma con impuestos', () => {
    expect(conImpuestos(100)).toBe(116);
  });

  it('rechaza un cupón inexistente', async () => {
    // Sin await: la promesa se resuelve despues de que la prueba termino.
    expect(buscarCupon('NO-EXISTE')).rejects.toThrow();
  });
});

declare function sumar(valores: number[]): number;
declare function aplicarDescuento(monto: number, pct: number): number;
declare function validarCupon(codigo: string): boolean;
declare function conImpuestos(monto: number): number;
declare function buscarCupon(codigo: string): Promise<unknown>;
