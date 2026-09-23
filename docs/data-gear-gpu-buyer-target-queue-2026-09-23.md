# Data-Gear GPU Buyer Target Queue — 2026-09-23

Source of truth profile: docs/data-gear-gpu-buyer-source-of-truth.md

Rules:
- Only include companies with a direct public infrastructure signal.
- No guessed personal emails.
- Dedupe against Comp CRM and outbound history before sending.
- When a verified buying trigger exists, move immediately from generic outreach to RFQ handling.

| Company | Domain | Infrastructure signal | Public contact | Source |
|---|---|---|---|---|
| DeepInfra | deepinfra.com | Markets dedicated NVIDIA B300 clusters, 256–5,000 GPUs, procured and operated by DeepInfra. | Contact form / sales path | https://deepinfra.com/ |
| General Compute | generalcompute.com | Dedicated inference capacity; public material discusses paired B300 fleet and physical data-center deployment. | jason@generalcompute.com; founders@generalcompute.com | https://www.generalcompute.com/ |
| QumulusAI | qumulusai.com | Active Blackwell B300 deployments and multi-year B300/B200 capacity agreements. | Public contact form; investors@qumulusai.com is investor relations only | https://www.qumulusai.com/articles |
| Confidential AI | confidential.ai | Publicly offers 8x B300 confidential GPU VMs and licensed private-inference stack. | hello@confidential.ai | https://confidential.ai/ |
| XDT | xdt.com | Owns/operates HGX B300 infrastructure; dedicated clusters from 256 to 2,048 GPUs. | sales@xdt.com | https://xdt.com/hardware.html |
| Sharon AI | sharonai.com | Neocloud operator deploying large B300 clusters; active NVIDIA infrastructure expansion. | Public website/contact path; do not use placeholder emails shown on management profile pages | https://sharonai.com/ |
| Together AI | together.ai | AI neocloud operating dedicated GPU clusters; 2026 YC dedicated GPU cluster and large infrastructure expansion. | Contact sales form | https://www.together.ai/contact-sales |
| InferX | inferx.net | Production inference platform deployable on customer-owned GPUs, Kubernetes, bare metal and private cloud. | team@inferx.net | https://inferx.net/ |
| Subconscious | subconscious.dev | Self-hosted inference system positioned as a force multiplier for enterprise GPU clusters. | hongyin@subconscious.dev for research; enterprise contact path | https://www.subconscious.dev/enterprise |
| NeuronCluster | neuroncluster.com | Enterprise self-hosted inference across owned GPU nodes and fleet-wide utilization. | info@neuroncluster.com | https://www.neuroncluster.com/ |
| NimbleCore | nimblecore.ai | GPU orchestration/inference platform; public examples reference 10–20 GPU fleets and self-hosted inference migration. | contact@nimblecore.ai | https://nimblecore.ai/ |
| Doubleword | doubleword.ai | Self-hosted enterprise inference platform focused on customer-controlled GPU infrastructure. | support@doubleword.ai; site sales path | https://doubleword.ai/ |
| NUSAPOD | nusapod.app | Inference platform explicitly built to run on GPUs the customer owns. | Site contact path | https://nusapod.app/ |
| Netris | netris.io | Network automation for AI neoclouds; reported live across 35+ GPU clusters and about one million GPUs. | Site contact path | https://www.netris.io/ |
| Fluence | fluence.ai | GPU cloud / bare-metal marketplace with H100/H200-class inference capacity and cluster requests. | Site sales path | https://fluence.ai/solutions/ai-inference |
| Arcline | arclineenergy.org | Own/rent GPU infrastructure on energized, high-density, liquid-cooling-ready capacity. | Site contact path | https://www.arclineenergy.org/ |
| American Compute | amcompute.com | Specializes in GPU infrastructure transactions, appraisals and neocloud build economics; useful buyer/partner signal. | hello@amcompute.com; deals@amcompute.com | https://www.amcompute.com/ |
| TAEON | taeontechnologies.com | Inference-efficiency control plane for AI datacenters; benchmarks on customer-owned GPUs. | gene@taeontechnologies.com | https://taeontechnologies.com/ |
| Bare Metal AI | baremetalrt.ai | Private AI runtime designed for owned GPU fleets, scaling from one workstation to large GPU fleets. | Site contact path | https://www.baremetalrt.ai/enterprise |
| Dryad Tech | dryadai.net | Builds self-hosted GPU-accelerated AI infrastructure on hardware customers control. | Site intake path | https://www.dryadai.net/ |

## Immediate outreach filter

Before any send:
1. Search Comp CRM for company/domain and existing contact.
2. Search recent Data-Gear outbound history.
3. Prefer technical founder, infrastructure, platform, data-center, procurement, or capital/deployment leader.
4. Use a verified public business email or company contact form.
5. Do not send to investor-relations/media addresses when a commercial/technical route is available.

## Strongest immediate buying-trigger signals

- DeepInfra: directly advertising own B300 cluster capacity.
- XDT: actively allocating HGX B300 cluster windows.
- Sharon AI: active B300 deployment program and infrastructure expansion.
- QumulusAI: active B300 deployments and capacity agreements.
- General Compute: building dedicated inference infrastructure and paired B300 capacity.
- Confidential AI: explicitly operating/renting 8x B300 nodes.

## Decision-maker pass — verified public roles

### General Compute
- Finn Puklowski — CEO & Co-Founder. Leads strategy, partnerships and product.
- Jason Goodison — CTO & Co-Founder. Owns architecture and development of the inference platform.
- Mark-Daniel — Compute Partnerships. Owns fund/platform relationships tied to inference capacity.
- Noa — Founding GTM. Handles customer conversations and capacity commitments.
- Best first route: Jason / Compute Partnerships, then founders.

### Confidential AI
- Ansgar Grunseid — Cofounder & CEO.
- Amean Asad — Cofounder & CTO.
- Patrick Woodhead — Head of Product.
- Best first route: hello@confidential.ai addressed to Ansgar or Amean.
- Buying signal: company publicly rents 8x B300 confidential VMs and licenses its stack for customer-owned GPUs.

### Sharon AI
- James Manning — Co-founder & CEO.
- David Burns — COO; responsible for end-to-end delivery and operation of the expanding AI infrastructure estate.
- Andrew Leece — Co-founder and Head of Strategic Partnerships; covers major customer, data-center and strategic relationships.
- Best first route: public company contact path addressed to David Burns / Andrew Leece.
- Buying signal: company disclosed a 1K B300 cluster deployment and expansion of GPU/network procurement.
- Data-quality warning: management pages expose obvious placeholder addresses such as 123example@gmail.com. Never use them.

### XDT
- Best first route: sales@xdt.com to the platform/hardware team.
- Buying signal: XDT states that it owns and operates the accelerators it deploys, is operator of record, and plans HGX B300 dedicated clusters from 256 to 2,048 GPUs.
- This is a direct hardware-owner profile, not merely a software company.

### QumulusAI
- Best first route: corporate contact form to infrastructure/procurement/deployment leadership.
- Do not use investors@qumulusai.com for sales outreach unless no commercial path is available.
- Buying signal: completed B300 capacity deployment at its Philadelphia colocation site in September 2026 and has announced additional dedicated B300 agreements.
- This company is a major infrastructure operator and should receive infrastructure-supply positioning, not generic GPU-server messaging.

## Outreach angle by profile

### Neocloud / infrastructure operator
Subject concept: GPU infrastructure availability
Message should ask whether they are adding incremental B300/B200 nodes or need alternate supply for upcoming deployments. Mention complete HGX systems, networking, memory, storage, rack integration, warranty and lead time.

### Inference platform / self-hosted AI company
Subject concept: GPU capacity / HGX systems
Message should reference private or dedicated inference capacity and ask whether they are expanding owned hardware. Avoid generic “AI infrastructure solutions” language.

### Software platform serving customer-owned GPUs
Treat as both a potential buyer and channel/referral partner. Ask whether they have customers looking for complete GPU servers or whether they procure hardware directly for deployments.

## Reference sources checked 2026-09-23

- General Compute team: https://www.generalcompute.com/team
- Confidential AI team: https://confidential.ai/team
- Confidential AI B300 VM offering: https://confidential.ai/
- XDT hardware: https://xdt.com/hardware.html
- XDT about/contact: https://xdt.com/about.html
- Sharon AI leadership: https://sharonai.com/about/
- Sharon AI executive expansion: https://sharonai.com/press-releases/sharon-ai-expands-executive-leadership-team-to-support-next-phase-of-growth-and-delivery/
- Sharon AI Q1 2026 results: https://sharonai.com/press-releases/sharon-ai-reports-first-quarter-2026-results/
- QumulusAI B300 deployment: https://www.qumulusai.com/articles/qumulusai-completes-nvidia-blackwell-b300-deployment-activating-18-million-take-or-pay-agreement
- QumulusAI contact: https://www.qumulusai.com/contact
