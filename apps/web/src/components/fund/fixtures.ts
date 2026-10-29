import { sanitizePublicFund } from "./sanitizer";
import type { PublicFund, RawFundRecord } from "./types";

export const DEMO_ROBOCUP_FUND: RawFundRecord = {
  id: "fnd_robocup_2026",
  name: "RoboCup 2026 Asia Fund",
  title: "RoboCup 2026 Asia Fund",
  purpose:
    "Travel, registration, and robotics hardware components for the IIT Delhi RoboCup student team competing in Tokyo.",
  description:
    "Travel, registration, and robotics hardware components for the IIT Delhi RoboCup student team competing in Tokyo.",
  phone: "+919876543210", // Private field to test sanitizer stripping
  bank_account_number: "98765432109876", // Private field to test sanitizer stripping
  ifsc_code: "HDFC0001234", // Private field
  org: {
    id: "org_iitd_robotics",
    name: "IIT Delhi Robotics Club",
    verified: true,
    legal_form: "Student Technical Club",
    owner_id: "usr_treasurer_01", // Private field
    owner_phone: "+919811122233", // Private field
  },
  total_raised_paise: 50000000, // ₹5,00,000.00
  total_spent_paise: 31850000, // ₹3,18,500.00
  spending_categories: [
    { category: "equipment", amount_paise: 14500000 }, // ₹1,45,000.00 (45%)
    { category: "travel", amount_paise: 9850000 }, // ₹98,500.00 (31%)
    { category: "registration", amount_paise: 5000000 }, // ₹50,000.00 (16%)
    { category: "logistics", amount_paise: 2500000 }, // ₹25,000.00 (8%)
  ],
  timeline: [
    {
      id: "evnt_01_donation_alumni",
      type: "donation",
      title: "Alumni Batch 2018 Sponsorship",
      description: "Annual tech sponsorship contributed through UPI.",
      amount_paise: 25000000, // ₹2,50,000.00
      occurred_at: "2026-10-15T09:30:00.000Z",
      status: "verified",
      donor_name: "Batch of 2018 Alumni",
      donor_phone: "+919999888877", // Private field to be stripped
      donor_user_id: "usr_donor_99", // Private field to be stripped
      proof_url: "/records/proof/evnt_01_donation_alumni",
      merkle_root: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    },
    {
      id: "evnt_02_exp_motors",
      type: "expense",
      title: "Omni-wheel DC Motors & Encoders",
      description: "Four Maxon DC motors for the soccer robot drivetrain.",
      amount_paise: 8500000, // ₹85,000.00
      category: "equipment",
      occurred_at: "2026-10-18T14:15:00.000Z",
      status: "verified",
      approver_ids: ["usr_appr_1", "usr_appr_2", "usr_appr_3"], // Private IDs
      evidence: {
        id: "evi_maxon_invoice_441",
        title: "Maxon Motors Official GST Tax Invoice",
        url: "/evidence/evi_maxon_invoice_441",
        content_sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      },
      proof_url: "/records/proof/evnt_02_exp_motors",
      merkle_root: "60383c452f16f0e0b0a4e890925ac4794f86d081884c7d659a2feaa0c55ad015",
    },
    {
      id: "evnt_03_donation_community",
      type: "donation",
      title: "Community Robotics Micro-Grants",
      description: "Public contributions from tech community donors.",
      amount_paise: 25000000, // ₹2,50,000.00
      occurred_at: "2026-10-20T11:00:00.000Z",
      status: "verified",
      donor_name: "Community Donors",
      donor_phone: "+919777666555",
      proof_url: "/records/proof/evnt_03_donation_community",
      merkle_root: "7d793037a0760186574b0282f2f435e7b1e516b94480805ff97c0d634946a2e9",
    },
    {
      id: "evnt_04_exp_travel",
      type: "expense",
      title: "Tokyo Flight Tickets (Advance)",
      description: "Air India confirmed group tickets for 5 students.",
      amount_paise: 9850000, // ₹98,500.00
      category: "travel",
      occurred_at: "2026-10-22T16:45:00.000Z",
      status: "verified",
      approver_ids: ["usr_appr_1", "usr_appr_2"],
      evidence: {
        id: "evi_airindia_tickets_912",
        title: "Air India Group Flight Confirmation",
        url: "/evidence/evi_airindia_tickets_912",
        content_sha256: "bc62d4b80d9e36da29c16c5d4d9f11731f36052c72401a76c23c0fb5a9cd2a24",
      },
      proof_url: "/records/proof/evnt_04_exp_travel",
      merkle_root: "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb",
    },
    {
      id: "evnt_05_exp_registration",
      type: "expense",
      title: "RoboCup Asia-Pacific Registration",
      description: "Official team entry and delegate registration fees.",
      amount_paise: 5000000, // ₹50,000.00
      category: "registration",
      occurred_at: "2026-10-24T10:20:00.000Z",
      status: "verified",
      approver_ids: ["usr_appr_1", "usr_appr_2", "usr_appr_3"],
      evidence: {
        id: "evi_robocup_receipt_09",
        title: "RoboCup Federation Entry Receipt",
        url: "/evidence/evi_robocup_receipt_09",
        content_sha256: "d41d8cd98f00b204e9800998ecf8427e9f86d081884c7d659a2feaa0c55ad015",
      },
      proof_url: "/records/proof/evnt_05_exp_registration",
      merkle_root: "3e23e8160039594a33894f6564e1b1348bbd7a0088d42c4acb73eeaed59c009d",
    },
    {
      id: "evnt_06_exp_sensors",
      type: "expense",
      title: "LiDAR Distance Sensor Kit",
      description: "Slamtec RPLIDAR A2M8 360-degree laser range scanner.",
      amount_paise: 6000000, // ₹60,000.00
      category: "equipment",
      occurred_at: "2026-10-25T13:10:00.000Z",
      status: "verified",
      approver_ids: ["usr_appr_1", "usr_appr_2"],
      evidence: {
        id: "evi_rplidar_invoice_12",
        title: "Vendor Tax Invoice - RoboElements",
        url: "/evidence/evi_rplidar_invoice_12",
        content_sha256: "2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae",
      },
      proof_url: "/records/proof/evnt_06_exp_sensors",
      merkle_root: "112613d9cfc28005391307efcf94e0fa8004f1a23869152b1b702ec40375a067",
    },
    {
      id: "evnt_07_exp_logistics",
      type: "expense",
      title: "Robotics Protective Flight Cases",
      description: "Custom foam aluminum Pelican flight cases for air transit.",
      amount_paise: 2500000, // ₹25,000.00
      category: "logistics",
      occurred_at: "2026-10-26T17:30:00.000Z",
      status: "pending",
      approver_ids: ["usr_appr_1"],
      evidence: {
        id: "evi_pelican_quote_51",
        title: "Store Estimate & GST Quote",
        url: "/evidence/evi_pelican_quote_51",
      },
      proof_url: "/records/proof/evnt_07_exp_logistics",
    },
  ],
  upi_vpa: "iitdrobotics@upi",
  upi_payee_name: "IIT Delhi Robotics Club",
};

export const SANITIZED_DEMO_FUND: PublicFund = sanitizePublicFund(DEMO_ROBOCUP_FUND);
