import type { ReactElement } from "react";
import { Money } from "./money";

// @ts-expect-error Amounts must be branded paise, never a plain number.
const invalidMoney: ReactElement = <Money amount={1005} />;

export { invalidMoney };
