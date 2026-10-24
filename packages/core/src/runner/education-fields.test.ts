import { describe, expect, it } from "vitest";
import type { FormField } from "../contracts.js";
import { degreeNames, educationAnswer, splitEducation, type EducationFact } from "./answers.js";

const edu: EducationFact[] = [
  { label: "Bachelor of Technology in Computer Science, National Institute of Technology Silchar", startDate: "2017", endDate: "2021" },
  { label: "Master of Science in Artificial Intelligence, Rochester Institute of Technology", startDate: "2024-08", endDate: "2026-05" },
];
const f = (label: string, options?: string[], kind: FormField["kind"] = options ? "select" : "text"): FormField => ({ label, kind, required: true, options, selector: "#x" });

describe("education labels", () => {
  it("splits degree, field and school whichever way round they come", () => {
    expect(splitEducation("Master of Science in Artificial Intelligence, Rochester Institute of Technology"))
      .toEqual({ school: "Rochester Institute of Technology", degree: "Master of Science", field: "Artificial Intelligence" });
    expect(splitEducation("Stanford University, B.S. Computer Science")).toMatchObject({ school: "Stanford University", degree: "B.S. Computer Science" });
    expect(splitEducation("MBA - Harvard Business School")).toMatchObject({ school: "Harvard Business School", degree: "MBA" });
    expect(splitEducation("")).toBeNull();
  });

  it("maps a degree to the names dropdowns use", () => {
    expect(degreeNames("Master of Science")).toContain("Master's");
    expect(degreeNames("B.Tech")).toContain("Bachelor's");
    expect(degreeNames("PhD in Physics")).toContain("Doctorate");
  });
});

describe("School, Degree and Discipline questions", () => {
  it("answers from the most recent education node", () => {
    expect(educationAnswer(f("School"), edu, "Software Engineer")).toBe("Rochester Institute of Technology");
    expect(educationAnswer(f("School", ["Rochester Institute of Technology", "Rochester Community College"]), edu, "x")).toBe("Rochester Institute of Technology");
    expect(educationAnswer(f("Degree", ["High School", "Associate's", "Bachelor's", "Master's", "Doctorate"]), edu, "x")).toBe("Master's");
    expect(educationAnswer(f("Degree"), edu, "x")).toBe("Master of Science");
    expect(educationAnswer(f("Discipline", ["Computer Science", "Artificial Intelligence", "Other"]), edu, "x")).toBe("Artificial Intelligence");
    expect(educationAnswer(f("Highest level of education", ["Bachelor's Degree", "Master's Degree"]), edu, "x")).toBe("Master's Degree");
  });

  it("leaves other questions and empty graphs alone", () => {
    expect(educationAnswer(f("School email"), edu, "x")).toBeUndefined();
    expect(educationAnswer(f("Degree"), [], "x")).toBeNull();
    expect(educationAnswer(f("What is your graduation date?"), edu, "x")).toBe("May 2026");
    expect(educationAnswer(f("Website"), edu, "x")).toBeUndefined();
  });
});
