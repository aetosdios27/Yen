import { paise } from "@yen/shared";
import { describe, expect, it } from "vitest";
import { renderNotificationTemplate } from "./templates.js";

describe("Notification templates (EN / HI)", () => {
  const fundTitle = "Community Water Fund";
  const expenseId = "exp-001";
  const donationId = "don-001";
  const objectionId = "obj-001";

  describe("approval_needed", () => {
    it("renders English with formatted INR paise and purpose", () => {
      const rendered = renderNotificationTemplate(
        "approval_needed",
        {
          fund_title: fundTitle,
          expense_id: expenseId,
          amount_paise: paise(15000),
          purpose: "Pump Repair",
        },
        "en",
      );
      expect(rendered.subject).toBe("Approval needed: Community Water Fund");
      expect(rendered.body).toBe(
        "Approval needed: An expense of ₹150.00 (Pump Repair) for Community Water Fund needs your review.",
      );
      expect(rendered.locale).toBe("en");
    });

    it("renders Hindi with formatted INR paise", () => {
      const rendered = renderNotificationTemplate(
        "approval_needed",
        {
          fund_title: fundTitle,
          expense_id: expenseId,
          amount_paise: paise(15000),
        },
        "hi",
      );
      expect(rendered.subject).toBe("मंज़ूरी आवश्यक: Community Water Fund");
      expect(rendered.body).toBe(
        "मंज़ूरी आवश्यक: Community Water Fund के लिए ₹150.00 के खर्च की समीक्षा आवश्यक है।",
      );
      expect(rendered.locale).toBe("hi");
    });
  });

  describe("approved_rejected", () => {
    it("renders approved in English", () => {
      const rendered = renderNotificationTemplate(
        "approved_rejected",
        {
          fund_title: fundTitle,
          expense_id: expenseId,
          amount_paise: paise(250000),
          decision: "approved",
        },
        "en",
      );
      expect(rendered.subject).toBe("Expense approved: Community Water Fund");
      expect(rendered.body).toBe(
        "Expense approved: An expense of ₹2,500.00 for Community Water Fund was approved.",
      );
    });

    it("renders approved in Hindi", () => {
      const rendered = renderNotificationTemplate(
        "approved_rejected",
        {
          fund_title: fundTitle,
          expense_id: expenseId,
          amount_paise: paise(250000),
          decision: "approved",
        },
        "hi",
      );
      expect(rendered.subject).toBe("खर्च स्वीकृत: Community Water Fund");
      expect(rendered.body).toBe(
        "खर्च स्वीकृत: Community Water Fund के लिए ₹2,500.00 का खर्च स्वीकृत हुआ।",
      );
    });

    it("renders rejected with reason in English and Hindi", () => {
      const en = renderNotificationTemplate(
        "approved_rejected",
        {
          fund_title: fundTitle,
          expense_id: expenseId,
          decision: "rejected",
          reason: "Policy limit exceeded",
        },
        "en",
      );
      expect(en.subject).toBe("Expense rejected: Community Water Fund");
      expect(en.body).toBe(
        "Expense rejected: An expense for Community Water Fund was rejected. Reason: Policy limit exceeded.",
      );

      const hi = renderNotificationTemplate(
        "approved_rejected",
        {
          fund_title: fundTitle,
          expense_id: expenseId,
          decision: "rejected",
          reason: "आपत्ति दर्ज",
        },
        "hi",
      );
      expect(hi.subject).toBe("खर्च अस्वीकृत: Community Water Fund");
      expect(hi.body).toBe(
        "खर्च अस्वीकृत: Community Water Fund के लिए खर्च अस्वीकृत किया गया। कारण: आपत्ति दर्ज।",
      );
    });
  });

  describe("donation_received", () => {
    it("renders donation received in English and Hindi", () => {
      const en = renderNotificationTemplate(
        "donation_received",
        {
          fund_title: fundTitle,
          donation_id: donationId,
          amount_paise: paise(50000),
        },
        "en",
      );
      expect(en.subject).toBe("Donation received: Community Water Fund");
      expect(en.body).toBe(
        "Donation received: ₹500.00 was received for Community Water Fund. Thank you!",
      );

      const hi = renderNotificationTemplate(
        "donation_received",
        {
          fund_title: fundTitle,
          donation_id: donationId,
          amount_paise: paise(50000),
        },
        "hi",
      );
      expect(hi.subject).toBe("दान प्राप्त हुआ: Community Water Fund");
      expect(hi.body).toBe("दान प्राप्त हुआ: Community Water Fund के लिए ₹500.00 प्राप्त हुए। धन्यवाद!");
    });
  });

  describe("objection_raised", () => {
    it("renders objection raised in English and Hindi", () => {
      const en = renderNotificationTemplate(
        "objection_raised",
        {
          fund_title: fundTitle,
          expense_id: expenseId,
          objection_id: objectionId,
          reason: "Missing quotation receipt",
        },
        "en",
      );
      expect(en.subject).toBe("Objection raised: Community Water Fund");
      expect(en.body).toBe(
        "Objection raised: An objection was raised on an expense in Community Water Fund. Details: Missing quotation receipt.",
      );

      const hi = renderNotificationTemplate(
        "objection_raised",
        {
          fund_title: fundTitle,
          expense_id: expenseId,
          objection_id: objectionId,
        },
        "hi",
      );
      expect(hi.subject).toBe("आपत्ति दर्ज की गई: Community Water Fund");
      expect(hi.body).toBe("आपत्ति दर्ज की गई: Community Water Fund में खर्च पर एक आपत्ति दर्ज की गई है।");
    });
  });

  describe("weekly_summary", () => {
    it("renders weekly summary in English and Hindi", () => {
      const en = renderNotificationTemplate(
        "weekly_summary",
        {
          fund_title: fundTitle,
          period_start: "2026-10-21",
          period_end: "2026-10-28",
          donations_count: 12,
          total_donations_paise: paise(150000),
          expenses_count: 3,
          total_expenses_paise: paise(45000),
        },
        "en",
      );
      expect(en.subject).toBe("Weekly summary: Community Water Fund");
      expect(en.body).toBe(
        "Weekly summary for Community Water Fund: 12 donations (₹1,500.00) received, 3 expenses (₹450.00) spent.",
      );

      const hi = renderNotificationTemplate(
        "weekly_summary",
        {
          fund_title: fundTitle,
          period_start: "2026-10-21",
          period_end: "2026-10-28",
          donations_count: 12,
          total_donations_paise: paise(150000),
          expenses_count: 3,
          total_expenses_paise: paise(45000),
        },
        "hi",
      );
      expect(hi.subject).toBe("साप्ताहिक विवरण: Community Water Fund");
      expect(hi.body).toBe(
        "साप्ताहिक विवरण (Community Water Fund): 12 दान (₹1,500.00) प्राप्त, 3 खर्च (₹450.00) किए गए।",
      );
    });
  });

  describe("validation and security", () => {
    it("throws on invalid data payload", () => {
      expect(() =>
        renderNotificationTemplate(
          "approval_needed",
          { fund_title: "", expense_id: expenseId, amount_paise: -100 },
          "en",
        ),
      ).toThrow();
    });
  });
});
