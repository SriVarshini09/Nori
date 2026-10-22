import type { Metadata } from "next";
import { CONTACT, Prose, REPO_URL } from "@/components/public/Chrome";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What Nori stores about you, who it is shared with, and how to export or delete it.",
};

export default function PrivacyPage() {
  return (
    <Prose title="Privacy" updated="20 October 2026">
      <section>
        <p>Nori helps you search and apply for jobs. To do that it needs your work history, so this page says plainly what is stored, where it goes, and how you remove it.</p>
      </section>

      <section>
        <h2>What Nori stores</h2>
        <ul>
          <li><strong>Your account:</strong> email address, name, and a salted hash of your password (never the password itself).</li>
          <li><strong>Your career graph and resumes:</strong> the text and facts read from the resume you add, the resumes you build in the studio, and every tailored version with the reasons for each change.</li>
          <li><strong>Your preferences and answers:</strong> job titles, locations, salary and work-authorisation answers, and the answers you give to application questions.</li>
          <li><strong>Your applications:</strong> the jobs you apply to, the form fields Nori filled, screenshots of the filled form (deleted 30 days after the application is settled), and the status of each application.</li>
          <li><strong>Connected services, if you connect them:</strong> messages from your mailbox that are about your job search (replies, interviews, codes, confirmations). Other mail is read once to sort it and is not kept. And the chat addresses (for example Telegram) you link.</li>
          <li><strong>A model key, if you add one:</strong> it is encrypted at rest and only used to call the model you chose for your own requests.</li>
          <li><strong>Sign-in sessions:</strong> a random token in a cookie. Only a hash of it is stored, together with your browser&apos;s user-agent text so you can recognise a device and sign it out in Settings.</li>
        </ul>
      </section>

      <section>
        <h2>Who else sees it</h2>
        <p>Nori does not sell your data and does not show advertising. Parts of your data leave Nori only when a feature needs another service:</p>
        <ul>
          <li><strong>The language model.</strong> When tailoring, answering questions or reading a resume uses a hosted model, the relevant text is sent to that model provider. If you add your own key, it goes to the provider you chose. If you run Nori with a local model, it stays on your machine.</li>
          <li><strong>Job boards and company pages.</strong> Nori reads public job postings. When you approve an application, the form is filled on the employer&apos;s own site and the information you approved is sent to that employer, as if you had typed it.</li>
          <li><strong>Email delivery.</strong> Account emails (confirm your address, reset your password) are sent through an email provider.</li>
          <li><strong>Connected tools.</strong> If you connect Gmail, Sheets, Calendar or Slack, that access goes through Composio, and only for the features you turn on.</li>
          <li><strong>Hosting.</strong> The app and its database run with the hosting providers the operator of this site has chosen.</li>
        </ul>
      </section>

      <section>
        <h2>Nothing is sent without you</h2>
        <p>By default Nori asks you to approve the tailored resume and then the filled form before it submits anything. You can change how much it does on its own in Settings, and you can switch that back at any time.</p>
      </section>

      <section>
        <h2>Cookies</h2>
        <p>Nori sets one cookie, which keeps you signed in. It does not use advertising or cross-site tracking cookies.</p>
      </section>

      <section>
        <h2>Your controls</h2>
        <ul>
          <li><strong>Export:</strong> download your career graph as JSON from the Career graph page, and any resume as PDF, Word, text or JSON.</li>
          <li><strong>Delete:</strong> Settings, Delete account, removes your account and everything keyed to it: graph, resumes, applications, inbox, linked channels and stored model key. It cannot be undone.</li>
          <li><strong>Sign out everywhere:</strong> Settings, Security, lists your signed-in devices and signs the others out.</li>
        </ul>
      </section>

      <section>
        <h2>Questions</h2>
        <p>
          {CONTACT ? <>Write to <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.</> : <>Open an issue in the <a href={REPO_URL} target="_blank" rel="noreferrer">project repository</a>.</>}
          {" "}Nori is open source, so you can read exactly what it does with your data.
        </p>
      </section>
    </Prose>
  );
}
