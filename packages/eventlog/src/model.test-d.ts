import type { Paise } from "@yen/shared";
import type { Event, EventInput, makeNextEvent, UnsignedEvent } from "./index.js";

type MoneyFields<T extends Event | EventInput | UnsignedEvent> = {
  donation: Extract<T, { type: "donation.pledged" }>["payload"]["amount_paise"];
  expense: Extract<T, { type: "expense.submitted" }>["payload"]["amount_paise"];
  credit: Extract<T, { type: "bank.credit_seen" }>["payload"]["amount_paise"];
  debit: Extract<T, { type: "bank.debit_seen" }>["payload"]["amount_paise"];
  balance: Extract<T, { type: "bank.balance_checked" }>["payload"]["balance_paise"];
};
type SharedMoneyFields = { [Key in keyof MoneyFields<Event>]: Paise };
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;

export type ParsedMoneyIsSharedPaise = Assert<Equal<MoneyFields<Event>, SharedMoneyFields>>;
export type UnsignedMoneyIsSharedPaise = Assert<
  Equal<MoneyFields<UnsignedEvent>, SharedMoneyFields>
>;
export type InputMoneyIsSharedPaise = Assert<Equal<MoneyFields<EventInput>, SharedMoneyFields>>;
export type ConstructorRejectsPlainNumberMoney = Assert<
  number extends MoneyFields<Parameters<typeof makeNextEvent>[1]>[keyof SharedMoneyFields]
    ? false
    : true
>;
