import { describe, expect, it } from 'vitest';
import {
  transferPriceUnits,
  transferTotalAmount,
} from '@/inventory/offer-pricing';
import { makeTransferOffer } from '../fixtures/transfer-offer';

describe('transfer offer pricing', () => {
  it('prices private vehicles by the number required for the party', () => {
    const offer = makeTransferOffer({ capacity: 3 });
    expect(transferPriceUnits(offer, 5)).toBe(2);
    expect(transferTotalAmount(offer, 5)).toBe(2_400);
  });

  it('prices ferry seats per traveller without treating capacity as a vehicle size', () => {
    const offer = makeTransferOffer({
      mode: 'shared',
      transportMode: 'ferry',
      capacity: 100,
      price: { amount: 500, currency: 'INR', unit: 'per_traveller' },
    });
    expect(transferPriceUnits(offer, 5)).toBe(5);
    expect(transferTotalAmount(offer, 5)).toBe(2_500);
  });
});
