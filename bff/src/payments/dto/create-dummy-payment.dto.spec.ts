import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PurchasePlan } from '@prisma/client';
import { CreateDummyPaymentDto } from './create-dummy-payment.dto';

describe('CreateDummyPaymentDto', () => {
    it('accepts PREMIUM and KRONIQ plans', () => {
        const premium = plainToInstance(CreateDummyPaymentDto, {
            plan: PurchasePlan.PREMIUM,
        });
        const kroniq = plainToInstance(CreateDummyPaymentDto, {
            plan: PurchasePlan.KRONIQ,
        });

        expect(validateSync(premium)).toEqual([]);
        expect(validateSync(kroniq)).toEqual([]);
    });

    it('rejects invalid plans', () => {
        const dto = plainToInstance(CreateDummyPaymentDto, {
            plan: 'INVALID_PLAN',
        });

        const errors = validateSync(dto);

        expect(errors).toHaveLength(1);
        expect(errors[0].constraints).toHaveProperty('isEnum');
    });
});
