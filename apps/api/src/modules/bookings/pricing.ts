/**
 * Placeholder call-out fee (KES) until matching (M8) quotes from the base fees of the vets who
 * would be offered the job. Pricing bands by distance are Open Question 21.7.
 */
export const DEFAULT_CALL_OUT_FEE_KES = 500;

/** The fee shown to the farmer before they confirm. Always computed on the server. */
export async function quoteCallOutFee(): Promise<number> {
  return DEFAULT_CALL_OUT_FEE_KES;
}
