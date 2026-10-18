import { formatDeadline, getDeadlineInfo } from "@/lib/format";
import type { Opportunity } from "@/lib/types";

export interface ResponseStep {
  title: string;
  detail?: string;
  /** The step's own deadline has passed. */
  passed?: boolean;
}

const SOLE_SOURCE = /notice of intent|sole[\s-]*source/i;
const MARKET_RESEARCH =
  /sources?\s*sought|request\s+for\s+information|\brfi\b|market\s+(research|survey)|special\s+notice/i;
const FEDERAL_AGENCY =
  /\b(HHS|NIH|CDC|FDA|DOD|DOE|EPA|USDA|NASA|NIST|USGS|DHS|VA|Department of (Defense|Energy|Veterans|Health and Human|Agriculture|Homeland|the Interior|Commerce|Justice|Labor|Transportation|the Army|the Navy|the Air Force))\b|U\.S\.|United States|\bFederal\b/i;

function isFederal(o: Opportunity): boolean {
  return /sam\.gov/i.test(o.sam_link ?? "") || FEDERAL_AGENCY.test(o.agency ?? "");
}

/** How to respond, built from what the agents captured about this notice. */
export function responseSteps(o: Opportunity, now: Date): ResponseStep[] {
  const kind = `${o.notice_type ?? ""} ${o.title}`;
  const steps: ResponseStep[] = [];

  if (SOLE_SOURCE.test(kind)) {
    steps.push({
      title: "Decide whether to challenge the sole-source award",
      detail:
        "A notice of intent names the vendor the agency plans to use. Respond only if you can show you can do the same work, usually with a capability statement.",
    });
  } else if (MARKET_RESEARCH.test(kind)) {
    steps.push({
      title: "Send a capability statement",
      detail:
        "This is market research, not a bid. A strong response can shape the final solicitation and its set-aside.",
    });
  } else {
    steps.push({
      title: "Read the solicitation and attachments",
      detail: "Check the scope, evaluation criteria, and required forms.",
    });
  }

  if (o.questions_deadline) {
    steps.push({
      title: `Send questions by ${formatDeadline(o.questions_deadline)}`,
      detail: o.poc_name ? `Questions go to ${o.poc_name}.` : undefined,
      passed: getDeadlineInfo(o.questions_deadline, now).status === "expired",
    });
  }

  steps.push(
    isFederal(o)
      ? {
          title: "Confirm your SAM.gov registration is active",
          detail: "Federal awards require an active SAM.gov registration and UEI.",
        }
      : {
          title: "Register as a vendor with the agency",
          detail: "Most state and local portals require vendor registration before you can submit.",
        },
  );

  steps.push({
    title: o.submission_method ? `Submit via ${o.submission_method}` : "Submit your response",
    detail:
      o.submission_instructions ??
      (o.submission_method
        ? undefined
        : "Submission details haven't been captured yet. Check the solicitation."),
  });

  if (o.response_deadline) {
    steps.push({
      title: `Responses due ${formatDeadline(o.response_deadline)}`,
      passed: getDeadlineInfo(o.response_deadline, now).status === "expired",
    });
  }

  return steps;
}
