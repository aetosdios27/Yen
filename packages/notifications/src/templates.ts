import { formatInr, type Paise, paise } from "@yen/shared";
import {
  type ApprovalNeededData,
  type ApprovedRejectedData,
  type DonationReceivedData,
  type FundAlertData,
  type NotificationLocale,
  type NotificationTemplateId,
  type ObjectionRaisedData,
  type RenderedTemplate,
  templateDataSchemas,
  type WeeklySummaryData,
} from "./types.js";

function toPaise(value: number | bigint | Paise): Paise {
  const num = typeof value === "bigint" ? Number(value) : value;
  return paise(num);
}

export function renderNotificationTemplate<T extends NotificationTemplateId>(
  templateId: T,
  rawData: unknown,
  locale: NotificationLocale = "en",
): RenderedTemplate {
  const schema = templateDataSchemas[templateId];
  const parsed = schema.parse(rawData);

  switch (templateId) {
    case "approval_needed": {
      const data = parsed as ApprovalNeededData;
      const amountStr = formatInr(toPaise(data.amount_paise));
      const purpose = data.purpose ? ` (${data.purpose})` : "";
      if (locale === "hi") {
        return {
          subject: `मंज़ूरी आवश्यक: ${data.fund_title}`,
          body: `मंज़ूरी आवश्यक: ${data.fund_title} के लिए ${amountStr}${purpose} के खर्च की समीक्षा आवश्यक है।`,
          locale: "hi",
        };
      }
      return {
        subject: `Approval needed: ${data.fund_title}`,
        body: `Approval needed: An expense of ${amountStr}${purpose} for ${data.fund_title} needs your review.`,
        locale: "en",
      };
    }

    case "approved_rejected": {
      const data = parsed as ApprovedRejectedData;
      const isApproved = data.decision === "approved";
      const amountStr = data.amount_paise ? ` of ${formatInr(toPaise(data.amount_paise))}` : "";
      const hiAmountStr = data.amount_paise ? ` ${formatInr(toPaise(data.amount_paise))} का` : "";
      const reasonStr = data.reason ? ` Reason: ${data.reason}.` : "";
      const hiReasonStr = data.reason ? ` कारण: ${data.reason}।` : "";

      if (locale === "hi") {
        if (isApproved) {
          return {
            subject: `खर्च स्वीकृत: ${data.fund_title}`,
            body: `खर्च स्वीकृत: ${data.fund_title} के लिए${hiAmountStr} खर्च स्वीकृत हुआ।`,
            locale: "hi",
          };
        }
        return {
          subject: `खर्च अस्वीकृत: ${data.fund_title}`,
          body: `खर्च अस्वीकृत: ${data.fund_title} के लिए खर्च अस्वीकृत किया गया।${hiReasonStr}`,
          locale: "hi",
        };
      }

      if (isApproved) {
        return {
          subject: `Expense approved: ${data.fund_title}`,
          body: `Expense approved: An expense${amountStr} for ${data.fund_title} was approved.`,
          locale: "en",
        };
      }
      return {
        subject: `Expense rejected: ${data.fund_title}`,
        body: `Expense rejected: An expense for ${data.fund_title} was rejected.${reasonStr}`,
        locale: "en",
      };
    }

    case "donation_received": {
      const data = parsed as DonationReceivedData;
      const amountStr = formatInr(toPaise(data.amount_paise));
      if (locale === "hi") {
        return {
          subject: `दान प्राप्त हुआ: ${data.fund_title}`,
          body: `दान प्राप्त हुआ: ${data.fund_title} के लिए ${amountStr} प्राप्त हुए। धन्यवाद!`,
          locale: "hi",
        };
      }
      return {
        subject: `Donation received: ${data.fund_title}`,
        body: `Donation received: ${amountStr} was received for ${data.fund_title}. Thank you!`,
        locale: "en",
      };
    }

    case "objection_raised": {
      const data = parsed as ObjectionRaisedData;
      const reasonStr = data.reason ? ` Details: ${data.reason}.` : "";
      const hiReasonStr = data.reason ? ` विवरण: ${data.reason}।` : "";
      if (locale === "hi") {
        return {
          subject: `आपत्ति दर्ज की गई: ${data.fund_title}`,
          body: `आपत्ति दर्ज की गई: ${data.fund_title} में खर्च पर एक आपत्ति दर्ज की गई है।${hiReasonStr}`,
          locale: "hi",
        };
      }
      return {
        subject: `Objection raised: ${data.fund_title}`,
        body: `Objection raised: An objection was raised on an expense in ${data.fund_title}.${reasonStr}`,
        locale: "en",
      };
    }

    case "weekly_summary": {
      const data = parsed as WeeklySummaryData;
      const donationsTotal = formatInr(toPaise(data.total_donations_paise));
      const expensesTotal = formatInr(toPaise(data.total_expenses_paise));
      if (locale === "hi") {
        return {
          subject: `साप्ताहिक विवरण: ${data.fund_title}`,
          body: `साप्ताहिक विवरण (${data.fund_title}): ${data.donations_count} दान (${donationsTotal}) प्राप्त, ${data.expenses_count} खर्च (${expensesTotal}) किए गए।`,
          locale: "hi",
        };
      }
      return {
        subject: `Weekly summary: ${data.fund_title}`,
        body: `Weekly summary for ${data.fund_title}: ${data.donations_count} donations (${donationsTotal}) received, ${data.expenses_count} expenses (${expensesTotal}) spent.`,
        locale: "en",
      };
    }

    case "fund_alert": {
      const data = parsed as FundAlertData;
      const severity = data.severity.toUpperCase();
      const escalated = data.variant === "escalation";
      if (locale === "hi") {
        if (escalated) {
          return {
            subject: `सूचना बढ़ाई गई (${severity}): ${data.fund_title}`,
            body: `${data.fund_title} के लिए ${data.title} की समीक्षा नहीं हुई है। कृपया तुरंत समीक्षा करें।`,
            locale: "hi",
          };
        }
        return {
          subject: `सूचना (${severity}): ${data.fund_title}`,
          body: `${data.fund_title} के लिए ${data.title}। कृपया समीक्षा करें।`,
          locale: "hi",
        };
      }
      if (escalated) {
        return {
          subject: `Escalated alert (${severity}): ${data.fund_title}`,
          body: `Escalated: ${data.title} for ${data.fund_title} has not been acknowledged. Please review urgently.`,
          locale: "en",
        };
      }
      return {
        subject: `Alert (${severity}): ${data.fund_title}`,
        body: `${data.title} for ${data.fund_title}. Please review.`,
        locale: "en",
      };
    }

    default: {
      const exhaustiveCheck: never = templateId;
      throw new Error(`Unsupported template: ${exhaustiveCheck}`);
    }
  }
}
