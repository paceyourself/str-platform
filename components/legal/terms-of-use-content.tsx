import {
  LegalA,
  LegalAddress,
  LegalH1,
  LegalH2,
  LegalLastUpdated,
  LegalLi,
  LegalOl,
  LegalP,
  LegalUl,
} from "@/components/legal/legal-page-shell";

type TermsVariant = "owner-direct" | "pm-sponsored";

export function TermsOfUseContent({ variant }: { variant: TermsVariant }) {
  const privacyHref =
    variant === "owner-direct"
      ? "http://www.verostr.com/privacy "
      : "http://www.verostr.com/privacy";

  return (
    <article>
      <LegalP>
        To agree to these terms, click the &ldquo;I agree&rdquo; button. If you
        do not agree to these terms, do not click &rdquo;I agree,&ldquo; and do
        not use the services.
      </LegalP>
      <LegalP>By clicking the &ldquo;I agree&rdquo; button:</LegalP>
      <LegalUl>
        <LegalLi>
          You acknowledge that you have read and understand these terms of use
          and agree to abide by them as a binding agreement.
        </LegalLi>
        <LegalLi>
          You affirm that you are at least 18 years of age, or at least 13 years
          of age and have permission from your parent or guardian to accept this
          agreement and use the services. The services are not intended for use
          by children under the age of 13.
        </LegalLi>
        <LegalLi>
          You affirm that you understand that if you provide your phone number
          or email address to the Company, you are giving the Company express
          written consent to contact you about your account or purchases.
        </LegalLi>
        <LegalLi>
          You expressly acknowledge that you have read and understand the
          disclaimers and limitations on your rights under Security and security
          violations, DMCA Notice to copyright owners, and Important disclaimers.
        </LegalLi>
      </LegalUl>

      <LegalH1>TERMS OF USE</LegalH1>
      <LegalP>
        Please read these terms carefully. This is a binding agreement between
        VeroSTR, LLC (referred to as &ldquo;Company,&rdquo; &ldquo;we,&rdquo;
        &ldquo;us&rdquo; or &ldquo;our&rdquo;) and any person who accesses or
        establishes a connection to the Services (&ldquo;you&rdquo; or
        &ldquo;User&rdquo;). By using or otherwise accessing the Services, or
        indicating your assent hereto by clicking &ldquo;I agree&rdquo; or
        similarly expressing acceptance where other options exist, you are
        accepting the terms of this agreement. The Company retains all rights
        other than those explicitly granted to you in this agreement.
      </LegalP>

      <LegalH2>ACCESS TO THIS SITE</LegalH2>
      <LegalP>
        To access any part of this website,{" "}
        <LegalA href="http://www.verostr.com/" external>
          http://www.verostr.com/
        </LegalA>{" "}
        (the &ldquo;Website&rdquo;) or other software, resources, or services
        available through the Website (all of the foregoing, the
        &ldquo;Services&rdquo;), you agree to comply with all of the terms of
        this agreement. To use some or all of the Services on the Website, you
        may be asked to provide registration information. It is a condition of
        using the Services that all the information you provide is correct,
        current, and complete. If the Company believes the information you
        provide is inaccurate, the Company may terminate or suspend your access
        to the Services.
      </LegalP>
      <LegalP>
        You agree that the Company may, without prior notice for any reason or no
        reason, immediately terminate your account and access to the Services.
        You understand and accept that the Company maintains complete discretion
        with respect to termination and that the Company will not be liable to
        you or any third party for any termination of your account.
      </LegalP>

      {variant === "owner-direct" ? (
        <>
          <LegalH2>ORDER FORM</LegalH2>
          <LegalP>
            The services, payment, and term language related to your account are
            located in the Order Form provided to you by the Company.
          </LegalP>
        </>
      ) : (
        <>
          <LegalH2>PAYMENT</LegalH2>
          <LegalP>
            Your property manager is paying a monthly subscription fee for your
            access to the Services and may request a monthly payment for platform
            access that may not exceed $15.20 per month.
          </LegalP>
        </>
      )}

      <LegalH2>FREE TRIALS AND OFFERS</LegalH2>
      <LegalP>
        We may periodically offer free trials or other complimentary offers to
        allow you to evaluate the Services as a &ldquo;Trial Member.&rdquo; Free
        trials or complimentary offers to use the Services begin immediately on
        the date of enrollment, not on the date the Services are first used
        after enrollment. This agreement, other than payment obligations,
        applies to Trial Members during any trial or complimentary period
        offered by the Company.
      </LegalP>

      <LegalH2>PRIVACY</LegalH2>
      <LegalP>
        The Company&apos;s Privacy Policy, located at{" "}
        {variant === "owner-direct" ? (
          <>
            <LegalA href="http://www.verostr.com/privacy" external>
              http://www.verostr.com/privacy
            </LegalA>{" "}
          </>
        ) : (
          <>
            <LegalA href="http://www.verostr.com/privacy" external>
              http://www.verostr.com/privacy
            </LegalA>
            ,
          </>
        )}
        describes the Company&apos;s collection and use of your personal and
        other information.
      </LegalP>

      <LegalH2>RESTRICTIONS ON USE</LegalH2>
      <LegalP>
        You may access the Services only for your personal or internal business
        purposes. You may not use the Services for any other purpose. You may
        not, for example, (1) modify, publish, distribute, transmit,
        systematically download, use automated means to index or extract data
        from, participate in the transfer or sale or rental of, translate,
        create derivative works from, frame, co-brand, or in any way exploit any
        part of the Services other than for personal or internal business use
        or as specifically permitted in this agreement, without the
        Company&apos;s written consent, or (2) use the Services in any harmful
        or illegal manner or interfere with any party&apos;s use or enjoyment of
        the Services. You agree to cooperate with the Company in causing any of
        your unauthorized use of the Services to cease immediately.
      </LegalP>

      <LegalH2>OWNERSHIP</LegalH2>
      <LegalP>
        The Company owns all right, title and interest in and to the Services,
        including all intellectual property rights therein.
      </LegalP>
      <LegalP>
        The material accessible from the Services, including text, data, images,
        interfaces, the &ldquo;look and feel&rdquo; of the Website, and other
        materials or works of authorship (the &ldquo;Content&rdquo;) is owned or
        licensed by the Company. You may not copy, distribute, republish,
        upload, post, transmit, or create derivative works of Content without
        the prior written consent of the Company. You may not remove, alter, or
        cause the removal or alteration, any copyright, trademark, trade name,
        service mark, or any other proprietary notice or legend appearing on any
        of the Content. The Company has the right to modify, manage or eliminate
        any Content at any time.
      </LegalP>
      <LegalP>
        The Company&apos;s name, logos, and other product and service identifiers
        are the Company&apos;s trademarks. All other trademarks appearing in the
        Services are the property of their respective owners. No rights are
        granted to you in these trademarks.
      </LegalP>

      <LegalH2>USER SUBMISSIONS</LegalH2>
      <LegalP>
        A &ldquo;Submission&rdquo; means any information, ideas or materials
        that Users provide to us via any post, upload, input or other submission
        to the Services. You retain ownership of your Submissions. You hereby
        grant the Company a perpetual, royalty-free, non-transferable,
        non-sublicensable, worldwide license to publicly display and use the
        Submission.
      </LegalP>
      <LegalP>
        You are solely responsible for any violation under any theory of law that
        a third party alleges relating to your Submissions, and any damages
        resulting therefrom. You may not post, send, submit, publish, or
        transmit in connection with the Services any material that (1) you do not
        have the right to post, including proprietary material of any third
        party, (2) contains information obtained illegally or advocates illegal
        activity or discusses an intent to commit an illegal act, (3) is vulgar,
        obscene, abusive or threatening, (4) libels, defames, or invades the
        privacy of other Users, (5) does not pertain directly to the subject
        matter of the Services or advertises another product or service, (6)
        includes programs that contain viruses, worms, or any other malicious
        computer code, or (7) contains hyperlinks to other sites that contain
        content that falls within the descriptions set forth above.
      </LegalP>
      <LegalP>
        You agree that you own a short-term rental property and your Submissions
        are (a) based on your personal experience with service providers, (b)
        you have not received any compensation from any party for the scores and
        comments that you provide. The Company strives to maintain honest,
        objective scores for service providers and, therefore, will, at the
        Company&apos;s sole discretion, remove any data that the Company believes
        violates any of the Company&apos;s policies or that the Company
        believes is inappropriate after a reasonable inquiry. The Company will
        not remove reviews or data based solely on an objection from a service
        provider.
      </LegalP>
      <LegalP>
        Without limiting the foregoing responsibilities of the Users, the Company
        may monitor the use of the Services to ensure compliance with this
        agreement. The Company may remove or refuse Submissions for any reason.
      </LegalP>

      <LegalH2>HYPERLINKS</LegalH2>
      <LegalP>
        The Services may include hyperlinks to other websites that are not owned
        or operated by the Company. These links are provided for your
        convenience, and the Company may receive commissions or further
        financial compensation from the owners of these websites. Hyperlinks are
        to be accessed at your own risk. The Company may not have reviewed, and
        does not necessarily endorse, the content of other websites. The
        Company has no control over other websites and is not liable for any
        content, advertising, products, services or other materials on or
        available from those websites. Nonetheless, we wish to protect the Users
        of the Services, and we therefore invite feedback about websites that
        are linked from the Website.
      </LegalP>

      <LegalH2>DMCA NOTICE TO COPYRIGHT OWNERS</LegalH2>
      <LegalP>
        The Company owns, protects and enforces copyrights in its own creative
        material and respects the copyrights of others. Materials may be made
        available on the Services, or via the Services, by third parties not
        within the control of the Company. It is our policy not to permit
        materials known by us to be infringing to remain on the Services. In
        accordance with the Digital Millennium Copyright Act, or
        &ldquo;DMCA&rdquo; (summary here), you should notify us promptly if you
        believe any materials displayed within the Services infringe your
        copyright; please send your notice by email for prompt attention.
        Regardless of whether we are liable for such infringement, our response
        may include removing or restricting access to material claimed to be
        infringing activity or terminating the alleged infringer&apos;s access
        to the Services. If we remove or restrict access in response to your
        notice, we will make a good-faith attempt to contact the person who
        submitted the material so that they may have the opportunity to submit a
        counter notification.
      </LegalP>
      <LegalP>
        Please send all notices to the Company at{" "}
        <LegalA href="mailto:dmca@verostr.com">dmca@verostr.com</LegalA> or 710
        N. Wright St, Naperville, Illinois 60563.
      </LegalP>
      <LegalP>
        VeroSTR&apos;s DMCA agent is registered with the U.S. Copyright Office
        (Registration No. DMCA-1073562).
      </LegalP>
      <LegalP>
        Your notice of alleged copyright infringement should include the
        following:
      </LegalP>
      <LegalUl>
        <LegalLi>
          A description of how your copyrighted work or other intellectual
          property has been infringed;
        </LegalLi>
        <LegalLi>
          A description of where the infringing material is located on the
          Services;
        </LegalLi>
        <LegalLi>
          Where we can contact you and, if different, where the allegedly
          infringing party can contact you;
        </LegalLi>
        <LegalLi>
          A statement that you believe that the use of the material is not
          authorized by the copyright or other intellectual property rights
          owner, by its agent, or by law;
        </LegalLi>
        <LegalLi>
          A statement, under penalty of perjury, that the information in the
          notification is correct and that you are authorized to act on behalf of
          the owner of the exclusive right that is alleged to be infringed; and
        </LegalLi>
        <LegalLi>Your electronic or physical signature.</LegalLi>
      </LegalUl>
      <LegalP>
        Please note that under the DMCA, misrepresentations made in your notices
        or counter notices can expose you to liability for substantial damages.
        If you are not sure whether material available on the Services infringes
        your copyright, or whether material posted by you is infringing, you
        should seek legal advice.
      </LegalP>

      <LegalH2>SECURITY AND SECURITY VIOLATIONS</LegalH2>
      <LegalP>
        If you are a User who has registered an account for the Services,
        passwords used to access the Services are for individual use only. You
        are responsible for the security of your own password and for all
        activities that occur through the use of your account if accessed with
        your password, including liability for damages resulting from misuse. If
        you use a password that the Company considers insecure, the Company may
        require you to change the password or terminate your account.
      </LegalP>
      <LegalP>
        You may not attempt to violate the security of the Services, or use the
        Services to violate the security of other persons or websites or to
        violate the law, including by: (1) accessing data not owned by or
        intended for you or logging into an account that you are not authorized
        to access; (2) attempting to probe, scan or test the vulnerability of
        the Services or to breach security or authentication measures; (3)
        attempting to interfere with service to any User, host or network,
        including without limitation, by submitting a virus to the Services; (4)
        sending unsolicited email; (5) forging any TCP/IP packet header or any
        part of the header information in any email; or (6) attempting to alter,
        make derivative works of, copy, disassemble or reverse engineer any of
        the software making up any part of the Services.
      </LegalP>
      <LegalP>
        The Company will take all reasonably necessary steps to investigate
        suspected violations of this agreement. The Company reserves the right to
        involve and fully cooperate with any law enforcement authorities and
        comply with court orders requesting or directing the Company to disclose
        the identity of anyone engaging in conduct that is believed to violate
        the law to the extent required by applicable law, regulation, or order.
        If permitted by applicable law, regulation, or order, the Company will
        provide you with prompt notice of the request. The Company further
        reserves the right, at its discretion, to release your details to system
        administrators at other sites in order to assist them in resolving
        security incidents.
      </LegalP>
      <LegalP>
        You release the Company from all liability for any action taken by the
        Company during or as a result of its investigations and for any actions
        taken as a consequence of investigations by either the Company or law
        enforcement authorities.
      </LegalP>

      <LegalH2>IMPORTANT DISCLAIMERS</LegalH2>
      <LegalP>
        Your use of the Services is at your own risk. The Services are provided
        on an &ldquo;as is&rdquo; and &ldquo;as available&rdquo; basis. The
        performance scores and benchmarks provided by the platform are based on
        VeroSTR&apos;s proprietary methodology and are provided for
        informational purposes only. VeroSTR makes no representations regarding
        their accuracy, completeness, or fitness for any particular purpose. The
        Company disclaims any warranties, express or implied, including any
        implied warranties of merchantability, fitness for a particular purpose,
        title, or non-infringement, and any warranties arising out of a course
        of dealing or usage of trade.
      </LegalP>
      <LegalP>
        The Company does not complete background checks on Users or make
        representations about the location, safety, or quality of the Users or
        Services. The Company has no responsibility for your interactions with
        other Users of the Services. Your interactions with such persons are at
        your own risk.
      </LegalP>
      <LegalP>
        By way of illustration, and without limiting the generality of the above
        disclaimers, the Company disclaims any warranty that:
      </LegalP>
      <LegalUl>
        <LegalLi>The Services will be uninterrupted or error-free;</LegalLi>
        <LegalLi>
          The Website and the servers that make the Services available are free
          of viruses or other harmful components; or
        </LegalLi>
        <LegalLi>
          The Content is accurate, complete, and free of typographical errors.
        </LegalLi>
      </LegalUl>
      <LegalOl>
        <LegalLi>
          The inclusion or offering for sale of any product or service as part
          of the Services does not constitute an endorsement or recommendation
          by the Company, and you agree not to make any claim against the
          Company relating to the purchase of these products or services.
        </LegalLi>
      </LegalOl>
      <LegalP>
        Updates to the Services may not be consistent across all platforms and
        devices.
      </LegalP>

      <LegalH2>LIMITATION OF LIABILITY</LegalH2>
      <LegalP>
        The Company, its subsidiaries, affiliates, licensors, service providers,
        content providers, employees, agents, officers, and directors are not
        liable to you for any incidental, direct, indirect, punitive, actual,
        consequential, special, exemplary, or other damages, including loss of
        revenue or income, pain and suffering, emotional distress, or similar
        damages, even if the Company has been advised of the possibility of such
        damages. If you are a California resident, you waive California Civil
        Code Section 1542, which states, in part: &ldquo;A general release does
        not extend to claims that the creditor or releasing party does not know
        or suspect to exist in his or her favor at the time of executing the
        release and that, if known by him or her, would have materially affected
        his or her settlement with the debtor or released party.&rdquo;
      </LegalP>
      <LegalP>
        In no event will the collective liability of the Company and its
        subsidiaries, affiliates, licensors, service providers, content
        providers, employees, agents, officers, and directors to you (regardless of
        the form of action, whether in contract, tort, or otherwise) exceed the
        total fees you pay in the year before the event triggering liability.
      </LegalP>

      <LegalH2>INDEMNIFICATION</LegalH2>
      <LegalP>
        To the maximum extent permitted by law, you agree to indemnify the
        Company, its subsidiaries, affiliates, licensors, service providers,
        content providers, employees, agents, officers, and directors from and
        against all third-party claims, liabilities and expenses, including legal
        fees and costs, relating to your use of the Services or your breach of
        any representation or obligation contained in this agreement. The
        Company reserves the right, in its sole discretion and at its own
        expense, to assume the exclusive defense and control of any claim for
        which you are obligated to provide indemnification under this section.
        You shall fully cooperate as reasonably required in the defense of any
        claim.
      </LegalP>

      <LegalH2>AMENDMENT</LegalH2>
      <LegalP>
        This agreement constitutes the entire agreement between the parties
        relating to the subject matter contained herein. The Company may modify
        this agreement at any time by posting the revised terms on the Website
        and providing you with the opportunity to accept or reject the
        modifications during your next sign-on to the Services. If you do not
        agree to the modifications, you may be required to cease your access to
        the Services. Continued use or access of the Services after modification
        will constitute your acceptance of this agreement as modified.
      </LegalP>

      <LegalH2>DISPUTE RESOLUTION; JURY WAIVER</LegalH2>
      <LegalP>
        All disputes relating to the interpretation of this agreement or the
        rights of the parties hereunder will be exclusively settled by
        arbitration administered by the American Arbitration Association
        (&ldquo;AAA&rdquo;) under its Commercial Arbitration Rules. Disputes
        involving $75,000 or less shall use the AAA&apos;s Expedited Rules. The
        parties shall mutually agree upon a single commercial arbitrator, and in
        the absence of agreement, the AAA shall select the arbitrator. The place
        of arbitration shall be Chicago, Illinois. The parties will share
        equally in the costs of arbitration payable to the AAA, including the
        arbitrator. The award of the arbitrator will be accompanied by a
        reasoned opinion. Judgment on an arbitration award may be entered in
        accordance with the Federal Arbitration Act in any federal court having
        jurisdiction.
      </LegalP>
      <LegalP>
        You acknowledge and agree that you and the Company are each waiving the
        right to a trial by jury and to participate as a plaintiff or class
        member in any purported class action or representative proceeding.
        Further, unless both you and the Company otherwise agree in writing, the
        arbitrator may not consolidate more than one person&apos;s claims and
        may not otherwise preside over any form of any class or representative
        proceeding.
      </LegalP>
      <LegalP>
        The parties to this agreement may, notwithstanding the above, seek
        equitable relief in any proper court to enjoin a breach or threatened
        breach of any obligations under this agreement that might cause
        irreparable harm (without any requirement to post bond).
      </LegalP>

      <LegalH2>CONTROLLING LAW</LegalH2>
      <LegalP>
        This agreement shall be governed and interpreted pursuant to the laws of
        the State of Illinois, United States of America, without regard to its
        choice of law rules. If any part of this agreement is unlawful, void, or
        unenforceable, that part will be deemed severable and will not affect the
        validity and enforceability of any remaining provisions. Any notices or
        other communications permitted or required hereunder will be in writing
        and given by the Company via email, to the address that you provided when
        registering for the Services, and will be effective upon transmission.
      </LegalP>

      <LegalH2>SURVIVAL OF TERMS</LegalH2>
      <LegalP>
        Privacy, Restrictions on use, Ownership, Security and security
        violations, Limitation of liability, Amendment, Dispute Resolution, Jury
        Waiver, Important disclaimers, and any other provision that refers to a
        period of time after you are no longer using the Services will continue
        in effect for the maximum period of time permitted by law.
      </LegalP>

      <LegalH2>ACCESSIBILITY</LegalH2>
      <LegalP>
        We work to provide Services that are compatible with commonly used
        assistive browsers, tools, and technologies. We strive to provide
        accessibility and usability for users, but accessibility is an ongoing
        effort, and it may not be possible in all areas of our Services with
        current technology and other restrictions.
      </LegalP>
      <LegalP>
        If you have questions, concerns or feedback related to the functionality
        or accessibility of the Services, please email us at the feedback address
        below.
      </LegalP>
      <LegalP>When you contact us, please be sure to tell us:</LegalP>
      <LegalUl>
        <LegalLi>the nature of the accessibility issue;</LegalLi>
        <LegalLi>your preferred format to receive a response;</LegalLi>
        <LegalLi>
          the relevant address for the webpage you are trying to access; and
        </LegalLi>
        <LegalLi>how to contact you.</LegalLi>
      </LegalUl>

      <LegalH2>CONTACT AND FEEDBACK</LegalH2>
      <LegalP>
        We welcome and encourage feedback, comments and suggestions for
        improvements to the Services (&ldquo;Feedback&rdquo;). You may submit
        Feedback by emailing us at{" "}
        <LegalA href="mailto:hello@verostr.com">hello@verostr.com</LegalA> or
        through the &ldquo;Help&rdquo; section of the Website. You agree that
        all Feedback will become the sole and exclusive property of the Company,
        and you hereby irrevocably assign to the Company all of your rights in
        and to all Feedback without any right to compensation.
      </LegalP>
      <LegalP>
        If you are a resident of California, you may request additional
        information or submit claims or complaints regarding the Services by
        calling the Complaint Assistance Unit of the Division of Consumer
        Services of California Department of Consumer Affairs at (800) 952-5210,
        or in writing at:
      </LegalP>
      <LegalAddress>
        Complaint Assistance Unit
        <br />
        Division of Consumer Services
        <br />
        California Department of Consumer Affairs
        <br />
        1625 N. Market Blvd., Suite N 112
        <br />
        Sacramento, California 95834.
      </LegalAddress>

      <LegalLastUpdated>Last updated: June 29, 2026</LegalLastUpdated>
    </article>
  );
}
