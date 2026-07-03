import {
  LegalA,
  LegalAddress,
  LegalH1,
  LegalH2,
  LegalH3,
  LegalLi,
  LegalP,
  LegalUl,
} from "@/components/legal/legal-page-shell";

const tableClass =
  "mt-4 w-full border-collapse text-left text-xs sm:text-sm";
const thClass =
  "border border-zinc-200 bg-zinc-100 px-3 py-2 font-semibold text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";
const tdClass =
  "border border-zinc-200 px-3 py-2 align-top text-zinc-700 dark:border-zinc-700 dark:text-zinc-300";

export function CcpaAddendumContent() {
  return (
    <article>
      <LegalH1>PRIVACY POLICY ADDENDUM FOR CALIFORNIA RESIDENTS</LegalH1>
      <LegalP>Effective June 29, 2026</LegalP>

      <LegalH2>Your Rights and Choices</LegalH2>
      <LegalP>
        The California Consumer Privacy Act of 2018 (&ldquo;CCPA&rdquo;) provides
        consumers residing in California (&ldquo;California Consumers&rdquo;)
        with specific rights regarding their personal information. This Notice
        supplements the VeroSTR, LLC Online Privacy Policy and applies solely to
        California Consumers.
      </LegalP>
      <LegalP>
        Personally Identifiable Information (&ldquo;personal information&rdquo;)
        is defined for purposes of this section of the Policy as information that
        identifies, relates, describes, references, is reasonably capable of being
        associated with, or could reasonably be linked to, directly or indirectly,
        you as an individual. Personal information includes information
        collected directly from you if you choose to purchase products, use certain
        services available on our sites or personal information that you
        voluntarily provide, such as information included in response to a
        questionnaire or survey, or if you apply for a job at our company.
      </LegalP>
      <LegalP>
        Under the CCPA and the unique consumer rights described below, personal
        information does not include:
      </LegalP>
      <LegalUl>
        <LegalLi>Publicly available information from government records;</LegalLi>
        <LegalLi>De-identified or aggregated consumer information;</LegalLi>
        <LegalLi>
          Health or medical information covered by the Health Insurance
          Portability and Accountability Act of 1996 (&ldquo;HIPAA&rdquo;) and
          the California Confidentiality of Medical Information Act
          (&ldquo;CMIA&rdquo;) or clinical trial data; and
        </LegalLi>
        <LegalLi>
          Personal information covered by certain sector-specific privacy laws,
          including the Fair Credit Reporting Act (&ldquo;FRCA&rdquo;), the
          Gramm-Leach-Bliley Act (&ldquo;GLBA&rdquo;), the California Financial
          Information Privacy Act (&ldquo;FIPA&rdquo;), and the Driver&apos;s
          Privacy Protection Act of 1994.
        </LegalLi>
      </LegalUl>

      <LegalH2>Collecting of Personal Information</LegalH2>
      <LegalP>
        In particular, we collect the following categories of personal
        information from our consumers:
      </LegalP>

      <div className="mt-4 overflow-x-auto">
        <table className={tableClass}>
          <thead>
            <tr>
              <th className={thClass}>Category</th>
              <th className={thClass}>Examples</th>
              <th className={thClass}>Collected</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className={tdClass}>A. Identifiers.</td>
              <td className={tdClass}>
                A real name, alias, postal address, unique personal identifier,
                online identifier, Internet Protocol address, email address,
                account name, Social Security number, driver&apos;s license
                number, passport number, or other similar identifiers.
              </td>
              <td className={tdClass}>YES</td>
            </tr>
            <tr>
              <td className={tdClass}>
                B. Personal information categories listed in the California
                Customer Records statute (Cal. Civ. Code § 1798.80(e)).
              </td>
              <td className={tdClass}>
                A name, signature, Social Security number, physical
                characteristics or description, address, telephone number,
                passport number, driver&apos;s license or state identification
                card number, insurance policy number, education, employment,
                employment history, bank account number, credit card number,
                debit card number, or any other financial information, medical
                information, or health insurance information. Some personal
                information included in this category may overlap with other
                categories.
              </td>
              <td className={tdClass}>YES</td>
            </tr>
            <tr>
              <td className={tdClass}>
                C. Protected classification characteristics under California or
                federal law.
              </td>
              <td className={tdClass}>
                Age (40 years or older), race, color, ancestry, national origin,
                citizenship, religion or creed, marital status, medical condition,
                physical or mental disability, sex (including gender, gender
                identity, gender expression, pregnancy or childbirth and related
                medical conditions), sexual orientation, veteran or military
                status, genetic information (including familial genetic
                information).
              </td>
              <td className={tdClass}>NO</td>
            </tr>
            <tr>
              <td className={tdClass}>D. Commercial information.</td>
              <td className={tdClass}>
                Records of personal property, products or services purchased,
                obtained, or considered, or other purchasing or consuming
                histories or tendencies.
              </td>
              <td className={tdClass}>YES</td>
            </tr>
            <tr>
              <td className={tdClass}>E. Biometric information.</td>
              <td className={tdClass}>
                Genetic, physiological, behavioral, and biological
                characteristics, or activity patterns used to extract a template
                or other identifier or identifying information, such as,
                fingerprints, faceprints, and voiceprints, iris or retina scans,
                keystroke, gait, or other physical patterns, and sleep, health,
                or exercise data.
              </td>
              <td className={tdClass}>NO</td>
            </tr>
            <tr>
              <td className={tdClass}>
                F. Internet or other similar network activity.
              </td>
              <td className={tdClass}>
                Browsing history, search history, information on a
                consumer&apos;s interaction with a website, application, or
                advertisement.
              </td>
              <td className={tdClass}>YES</td>
            </tr>
            <tr>
              <td className={tdClass}>G. Geolocation data.</td>
              <td className={tdClass}>Physical location or movements.</td>
              <td className={tdClass}>NO</td>
            </tr>
            <tr>
              <td className={tdClass}>H. Sensory data.</td>
              <td className={tdClass}>
                Audio, electronic, visual, thermal, olfactory, or similar
                information.
              </td>
              <td className={tdClass}>NO</td>
            </tr>
            <tr>
              <td className={tdClass}>
                I. Professional or employment-related information.
              </td>
              <td className={tdClass}>
                Current or past job history or performance evaluations.
              </td>
              <td className={tdClass}>NO</td>
            </tr>
            <tr>
              <td className={tdClass}>
                J. Non-public education information (per the Family Educational
                Rights and Privacy Act (20 U.S.C. Section 1232g, 34 C.F.R. Part
                99)).
              </td>
              <td className={tdClass}>
                Education records directly related to a student maintained by an
                educational institution or party acting on its behalf, such as
                grades, transcripts, class lists, student schedules, student
                identification codes, student financial information, or student
                disciplinary records.
              </td>
              <td className={tdClass}>NO</td>
            </tr>
            <tr>
              <td className={tdClass}>
                K. Inferences drawn from other personal information.
              </td>
              <td className={tdClass}>
                Profile reflecting a person&apos;s preferences, characteristics,
                psychological trends, predispositions, behavior, attitudes,
                intelligence, abilities, and aptitudes.
              </td>
              <td className={tdClass}>NO</td>
            </tr>
          </tbody>
        </table>
      </div>

      <LegalP>
        We obtain the categories of personal information listed above from the
        following categories of sources:
      </LegalP>
      <LegalUl>
        <LegalLi>
          Directly from you. We collect your information when you complete forms
          or you purchase services.
        </LegalLi>
        <LegalLi>
          Indirectly from you. We collect your information when you are browsing
          on our website.
        </LegalLi>
        <LegalLi>
          We also collect information from other sources including, but not
          limited to: advertising networks, internet service providers, data
          analytics providers, government entities, operating systems and
          platforms, social networks and data brokers
        </LegalLi>
      </LegalUl>

      <LegalH2>Use of Personal Information</LegalH2>
      <LegalP>
        We may disclose personal information we collect for one or more of
        business purposes as described in our Privacy Policy.
      </LegalP>

      <LegalH2>Sharing of Personal Information</LegalH2>
      <LegalP>
        We may disclose your personal information to a third party for a business
        purpose or sell your personal information, subject to your right to
        opt-out of those sales.
      </LegalP>

      <LegalH3>Disclosures of Personal Information for a Business Purpose</LegalH3>
      <LegalP>
        We may disclose the following categories of personal information for a
        business purpose:
      </LegalP>
      <LegalUl>
        <LegalLi>Category A: Identifiers.</LegalLi>
        <LegalLi>
          Category B: California Customer Records personal information
          categories.
        </LegalLi>
        <LegalLi>Category D: Commercial information.</LegalLi>
        <LegalLi>Category F: Internet or other similar network activity.</LegalLi>
      </LegalUl>

      <LegalH3>Sales of Personal Information</LegalH3>
      <LegalP>
        We have not yet sold personal information to any third parties.
      </LegalP>
      <LegalP>
        We do not collect or share the personal information of any covered
        consumers under the age of 16.
      </LegalP>

      <LegalH2>Access to Specific Information and Data Portability Rights</LegalH2>
      <LegalP>
        Subject to the exceptions set forth in the CCPA, you have the right to
        request that we disclose certain information to you about our collection
        and use of your personal information covered over the past 12 months.
        Once we receive and confirm your verifiable consumer request, we will
        disclose to you:
      </LegalP>
      <LegalUl>
        <LegalLi>
          The categories of personal information we collected about you;
        </LegalLi>
        <LegalLi>
          The categories of sources for the personal information we collected
          about you;
        </LegalLi>
        <LegalLi>
          Our business or commercial purpose for collecting or selling your
          personal information;
        </LegalLi>
        <LegalLi>
          The categories of third parties with whom we share personal
          information;
        </LegalLi>
        <LegalLi>
          The specific pieces of personal information we collected about you;
        </LegalLi>
        <LegalLi>
          If we sold or disclosed your personal information for a business
          purpose, two separate lists disclosing:
        </LegalLi>
        <LegalLi>
          sales, identifying the personal information categories that each
          category of recipient purchased; and
        </LegalLi>
        <LegalLi>
          disclosures for a business purpose, identifying the personal
          information categories that each category of recipient obtained.
        </LegalLi>
      </LegalUl>
      <LegalP>
        You can make this request by contacting us at{" "}
        <LegalA href="mailto:legal@verostr.com">legal@verostr.com</LegalA>.
      </LegalP>

      <LegalH2>Deletion Request Rights</LegalH2>
      <LegalP>
        Subject to the exceptions in the CCPA, you have the right to request
        that we delete any of your personal information collected from you and
        retained by us. Once we receive and confirm your verifiable consumer
        request, we will delete (and direct our service providers to delete) your
        personal information from our records, unless an exception applies.
      </LegalP>
      <LegalP>
        We may deny your deletion request if retaining the information is
        necessary for us or our service provider(s) to:
      </LegalP>
      <LegalUl>
        <LegalLi>
          Complete the transaction for which we collected the personal
          information, provide a good or service that you requested, take actions
          reasonably anticipated within the context of our ongoing business
          relationship with you, or otherwise perform our contract with you;
        </LegalLi>
        <LegalLi>
          Detect security incidents, protect against malicious, deceptive,
          fraudulent, or illegal activity, or prosecute those responsible for
          such activities;
        </LegalLi>
        <LegalLi>
          Debug products to identify and repair errors that impair existing
          intended functionality;
        </LegalLi>
        <LegalLi>
          Exercise free speech, ensure the right of another consumer to exercise
          their free speech rights, or exercise another right provided for by
          law;
        </LegalLi>
        <LegalLi>
          Comply with the California Electronic Communications Privacy Act (Cal.
          Penal Code § 1546 et. seq.);
        </LegalLi>
        <LegalLi>
          Engage in public or peer-reviewed scientific, historical, or
          statistical research in the public interest that adheres to all other
          applicable ethics and privacy laws, when the information&apos;s
          deletion may likely render impossible or seriously impair the
          research&apos;s achievement, if you previously provided informed
          consent;
        </LegalLi>
        <LegalLi>
          Enable solely internal uses that are reasonably aligned with consumer
          expectations based on your relationship with us;
        </LegalLi>
        <LegalLi>Comply with a legal obligation; and</LegalLi>
        <LegalLi>
          Make other internal and lawful uses of that information that are
          compatible with the context in which you provided it.
        </LegalLi>
      </LegalUl>
      <LegalP>
        You can make this request by contacting us at{" "}
        <LegalA href="mailto:legal@verostr.com">legal@verostr.com</LegalA>.
      </LegalP>

      <LegalH2>
        Exercising Access, Data Portability, and Deletion Rights
      </LegalH2>
      <LegalP>
        Only you, or a person registered with the California Secretary of State
        that you authorize to act on your behalf, may make a verifiable consumer
        request related to your personal information. You may also make a
        verifiable consumer request on behalf of your minor child.
      </LegalP>
      <LegalP>
        You may only make a verifiable consumer request for access or data
        portability twice within a 12-month period. The verifiable consumer
        request must:
      </LegalP>
      <LegalUl>
        <LegalLi>
          Provide sufficient information, commensurate to the type or
          sensitivity of the information you are requesting, that allows us to
          reasonably verify you are the person about whom we collected personal
          information or an authorized representative; and
        </LegalLi>
        <LegalLi>
          Describe your request in sufficient detail that allows us to properly
          understand, evaluate, and respond to it.
        </LegalLi>
      </LegalUl>
      <LegalP>
        We cannot respond to your request or provide you with personal
        information if we cannot verify your identity or authority to make the
        request and confirm the personal information relates to you. We will only
        use personal information provided in a verifiable consumer request to
        verify the requestor&apos;s identity or authority to make the request.
      </LegalP>

      <LegalH2>Response Timing and Format</LegalH2>
      <LegalP>
        We endeavor to respond to a verifiable consumer request within
        forty-five (45) days of its receipt. If we require more time (up 90
        days), we will inform you of the reason and extension period in writing.
        If you have an account with us, we will deliver our written response to
        that account. If you do not have an account with us, we will deliver our
        written response by mail or electronically, at your option. Any
        disclosures we provide will only cover the 12-month period preceding the
        verifiable consumer request&apos;s receipt. The response we provide will
        also explain the reasons we cannot comply with a request, if applicable.
        For data portability requests, we will select a format to provide your
        personal information that is readily useable and should allow you to
        transmit the information from one entity to another entity without
        hindrance, specifically by electronic mail communication.
      </LegalP>
      <LegalP>
        We do not charge a fee to process or respond to your verifiable consumer
        request unless it is excessive, repetitive, or manifestly unfounded. If
        we determine that the request warrants a fee, we will tell you why we
        made that decision and provide you with a cost estimate before completing
        your request.
      </LegalP>

      <LegalH2>Non-Discrimination</LegalH2>
      <LegalP>
        We will not discriminate against you for exercising any of your CCPA
        rights. Unless permitted by the CCPA, we will not:
      </LegalP>
      <LegalUl>
        <LegalLi>Deny you goods or services.</LegalLi>
        <LegalLi>
          Charge you different prices or rates for goods or services, including
          through granting discounts or other benefits, or imposing penalties.
        </LegalLi>
        <LegalLi>
          Provide you a different level or quality of goods or services.
        </LegalLi>
        <LegalLi>
          Suggest that you may receive a different price or rate for goods or
          services or a different level or quality of goods or services.
        </LegalLi>
      </LegalUl>
      <LegalP>
        However, we may offer you certain financial incentives permitted by the
        CCPA that can result in different prices, rates, or quality levels. Any
        CCPA-permitted financial incentive we offer will reasonably relate to your
        personal information&apos;s value and contain written terms that
        describe the program&apos;s material aspects. Participation in a
        financial incentive program requires your prior opt in consent, which you
        may revoke at any time.
      </LegalP>

      <LegalH2>Other California Privacy Rights</LegalH2>
      <LegalP>
        California&apos;s &ldquo;Shine the Light&rdquo; law (Civil Code Section §
        1798.83) permits users of our Website that are California residents to
        request certain information regarding our disclosure of personal
        information to third parties for their direct marketing purposes. To make
        such a request, please notify us at{" "}
        <LegalA href="mailto:legal@verostr.com">legal@verostr.com</LegalA> or
        710 N. Wright Street, Naperville, Illinois 60563.
      </LegalP>

      <LegalH2>Changes to Our Privacy Notice</LegalH2>
      <LegalP>
        We reserve the right to amend this California privacy notice at our
        discretion and at any time. When we make changes to this California
        privacy notice, we will post the updated notice on the Website and update
        the notice&apos;s effective date. Your continued use of our Website
        following the posting of changes constitutes your acceptance of such
        changes.
      </LegalP>
      <LegalP>
        Changes to this California privacy notice will not affect our use of
        previously provided personal information.
      </LegalP>

      <LegalH2>Contact Information</LegalH2>
      <LegalP>
        If you have any questions about this California privacy notice, the ways
        in which we collect and use your information described in this notice,
        your choices and rights regarding such use, please contact us as follows:
      </LegalP>
      <LegalUl>
        <LegalLi>
          Sending an e-mail request to:{" "}
          <LegalA href="mailto:legal@verostr.com">legal@verostr.com</LegalA>.
        </LegalLi>
        <LegalLi>Sending a letter to:</LegalLi>
      </LegalUl>
      <LegalAddress>
        VeroSTR, LLC
        <br />
        710 N. Wright St.
        <br />
        Naperville, IL 60563
      </LegalAddress>
    </article>
  );
}
