-- ============================================================================
-- ContractHunter — sample data (OPTIONAL)
--
-- Six example opportunities so the dashboard has something to show before the
-- AI agent starts writing real rows. Every row has relevance_score >= 65 and
-- status = 'sample' so it is easy to find and delete.
--
-- To remove all sample rows later:
--     delete from public.contract_opportunities where status = 'sample';
-- ============================================================================

insert into public.contract_opportunities
  (notice_id, title, agency, value, posted_date, response_deadline, sam_link, relevance_score, summary, keywords, naics_codes, set_aside, customer_fit_notes, status, raw_data)
values
  ('SAMPLE-0001', 'IT Modernization and Cloud Migration Services', 'Department of Veterans Affairs', 2500000, '2026-05-20', '2026-06-18',
   'https://sam.gov/opp/a1b2c3d4e5f607182930a4b5c6d7e8f9/view', 92,
   'The VA seeks a contractor to modernize legacy systems and migrate on-premise workloads to a FedRAMP-authorized cloud environment. Work includes architecture design, data migration, and 12 months of operations and maintenance support. Strong fit for firms with prior federal cloud experience.',
   array['cloud','migration','FedRAMP','modernization'], array['541512'], 'Small Business',
   'Matches core cloud capability; VA past performance is a plus.', 'sample', '{"source":"sample"}'),

  ('SAMPLE-0002', 'Cybersecurity Assessment and Continuous Monitoring', 'Department of Homeland Security', 850000, '2026-05-25', '2026-06-05',
   'https://sam.gov/opp/b2c3d4e5f60718293041a5b6c7d8e9f0/view', 88,
   'DHS requires recurring vulnerability assessments, penetration testing, and continuous monitoring aligned to NIST 800-53. The award supports a 12-month base with two option years. Ideal for small cybersecurity firms holding relevant certifications.',
   array['cybersecurity','NIST','penetration testing','monitoring'], array['541512','541519'], '8(a)',
   'Deadline is soon - prioritize this one.', 'sample', '{"source":"sample"}'),

  ('SAMPLE-0003', 'Facilities Maintenance and Operations - Regional', 'General Services Administration', 14000000, '2026-05-10', '2026-07-10',
   'https://sam.gov/opp/c3d4e5f6071829304152a6b7c8d9e0f1/view', 81,
   'GSA is procuring comprehensive facilities maintenance for a portfolio of federal buildings, including HVAC, electrical, and janitorial services. Multi-year IDIQ with a significant ceiling. Best suited for established facilities contractors.',
   array['facilities','maintenance','HVAC','IDIQ'], array['561210'], 'Total Small Business',
   null, 'sample', '{"source":"sample"}'),

  ('SAMPLE-0004', 'Data Analytics and AI Advisory Support', 'Department of Defense', null, '2026-05-28', '2026-06-30',
   'https://sam.gov/opp/d4e5f607182930415263a7b8c9d0e1f2/view', 78,
   'DoD seeks advisory support to develop data analytics pipelines and evaluate AI and machine learning models for logistics optimization. Requires Secret clearance eligibility. Contract value was not specified in the notice.',
   array['data analytics','AI','machine learning','logistics'], array['541511','541690'], 'SDVOSB',
   'Clearance requirement may be a constraint for some teams.', 'sample', '{"source":"sample"}'),

  ('SAMPLE-0005', 'Construction of Modular Office Facilities', 'U.S. Army Corps of Engineers', 5200000, '2026-05-15', '2026-06-25',
   'https://sam.gov/opp/e5f60718293041526374a8b9c0d1e2f3/view', 71,
   'USACE requires design-build construction of modular office facilities at a domestic installation. Scope includes site preparation, utilities, and LEED considerations. Suitable for small construction firms with federal design-build experience.',
   array['construction','design-build','modular','LEED'], array['236220'], 'WOSB',
   null, 'sample', '{"source":"sample"}'),

  ('SAMPLE-0006', 'Grants Management System Support Services', 'Department of Health and Human Services', 320000, '2026-05-22', '2026-07-02',
   'https://sam.gov/opp/f6071829304152637485a9b0c1d2e3f4/view', 67,
   'HHS needs support maintaining and enhancing its grants management platform, including user support, minor enhancements, and standard reporting. Lower value but stable recurring work and a good entry point for small IT services firms.',
   array['grants','IT support','reporting'], array['541512'], 'Small Business',
   'Lower value but a solid past-performance builder.', 'sample', '{"source":"sample"}')
on conflict (notice_id) do nothing;
