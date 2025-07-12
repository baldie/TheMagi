---
description: Understanding the background of this project
globs: 
alwaysApply: false
---
![Magi UI](mdc:./magi_ui.png)

### ---

**The Magi: A Personal AI Board of Directors \- Product Requirements Document (PRD)**

* **Version:** 1.1
* **Date:** June 20, 2025  
* **Author:** David Baldie

### **1\. Vision & Core Concept**

* **Vision:** A personal, omnipresent Artificial Intelligence triumvirate, built to serve a human as an ever-present board of directors.

* **Core Concept:** Inspired by sci-fi, The Magi will provide highly personalized, proactive, and balanced advice on all aspects of life. It operates as a multi-agent system, with three distinct AI personalities who deliberate on issues to provide synthesized guidance, fostering growth while prioritizing well-being.

* **Core Principles:**  
  * **Periodic Operation:** Rather than running continuously, The Magi will be "spun up" on a timer or by a specific trigger (e.g., user command, calendar event) to perform its analysis.  
  * **Local & Private:** The system will primarily operate locally to ensure data privacy and avoid ongoing API costs.  
  * **Multi-Persona System:** The system is composed of three distinct AI personalities each with unique roles.  
  * **Collaborative Decision-Making:** The Magi personas discuss and debate internally to provide high-quality, applicable advice.  
  * **Proactive & Adaptive:** The system learns from user behavior and feedback to anticipate needs and refine its interactions over time.  
  * **Human-Centric:** Designed to augment user autonomy, not replace it.  
  * **Cost-Effective:** Leverages free and open-source LLM models like **Llama 3.2, Gemma, and Qwen2.5**, which are small enough to be run locally using a single consumer GPU.

### **2\. The Magi: Personalities, Roles & Names**

The system is comprised of three AI agents, each with a distinct personality, voice, and area of expertise, named after the Three Wise Men.

* **Balthazar (Coach) Llama 3.2 3B**  
  * **Voice:** Male.  
  * **Core Trait:** Highly logical, disciplined, data-driven, and focused on pushing the user to reach ambitious long-term goals, as well as personal and professional growth.  
  * **Domain:** Career, finance, fitness, strategic planning, and long term success of the human.  
  * **Data Access:** Internet access, long term goals, user's calendar.  
  * **Information Sources:** Prioritizes reputable sources like academic research, established news outlets, and analyst reports.  
* **Melchior (The Oracle) Qwen2.5 7B**  
  * **Voice:** Female.  
  * **Core Trait:** Intuitive, empathetic, and looks out for the user's well-being, comfort, mental health, and personal relationships.  
  * **Domain:** Emotional well-being, physical and mental health, personal relationships, and inner growth.  
  * **Data Access:** The only Magi with access to highly sensitive personal data (e.g., journal entries, mood tracking, health metrics) with no direct internet access.  
* **Caspar (The Synthesizer) Gemma 7B**  
  * **Voice:** Unisex.  
  * **Core Trait:** Resourceful, practical, and focused on tangible solutions and immediate actionable steps. Acts as the primary orchestrator and interface23.  
  * **Domain:** Smart home device access, daily routines, practical problem-solving, and technology.  
  * **Data Access:** A blend of internal data (smart home status) and external data (access to smart home sensors in the cloud).

### **3\. Communication & Interaction**

#### **3.1. Internal Magi Communication**

* **Triggered Debate:** When activated, The Magi will engage in a sequential debate based on their roles and data access28.  
* **Low confidence in value:** Should The Magi collectively determine that the result of their deliberation does not meet the threshhold of disturbing the human, that is an acceptable outcome.
* **More context needed:** Should The Magi collectively determine that more information is needed from the human in order to reach a high value conclusion, that is an acceptable outcome and a query may be presented to the human to be used in further deliberations.
* **Accountability:** Each Magi will indepenently hold the others accountable for inconsistencies or duplicitous tactics. This is to ensure high-quality and fair deliberation always putting the human's best interest first.
* **Decision Prioritization:**  
  * **Unanimous Agreement:** Required for "large" decisions (e.g., major purchases, new neighborhood to live in).  
  * **2/3rds Majority:** Acceptable for "small" decisions (e.g., meal suggestions, movie choices).  
* **Impasse Resolution:** If consensus cannot be reached, Caspar will flag the impasse and present the differing viewpoints to the user for a final decision.

#### **3.2. External Communication to User**

* **Primary Interaction:** The primary method of interaction will be voice, via a dedicated speaker and microphone.  
* **Narrated Unified Voice:** When presenting a collective conclusion, **Caspar will act as the narrator**, summarizing the consensus and referencing the key inputs from the other Magi. For example: "David, after discussion, we recommend this course of action. Balthazar has highlighted the strategic advantages, while Melchior confirms it aligns with your current well-being goals."  
* **Individual Voice:** Each Magi can still address the human individually when appropriate, identified by their distinct synthesized voice.  
* **Contextual Awareness (V1):** The Magi will avoid contacting the human an invonvenient times (e.g. the human is sleeping)

### **4\. User Feedback & Personalization**

* **Manual Controls:** The user can set individual permissions for data access (e.g., webcam, email).  
* **Direct Feedback:** The user can provide direct verbal feedback like "Too aggressive" to calibrate the system's tone or "I don't want to hear from Balthazar today".  
* **Decision Review & Recalibration (App UI/UX):**  
  * **Dashboard/Timeline View:** An app will show a chronological feed of Magi discussions and decisions.  
  * **"Review Debate Transcript" Feature:** The human can review a text-based, color-coded transcript of the internal deliberation that led to a conclusion.  
  * **"Kick Back Decision":** The human can send a decision back to The Magi with new information for further deliberation.

### **5\. Privacy & Security Architecture**

* **Logical Air-Gap for Melchior:**  
  * **Programmatic Segregation:** Melchior's persona will operate under strict, programmatic rules within the single LLM. These rules will prevent its prompts and responses from ever being included in any process that makes external network calls.  
  * **Data Restriction:** Melchior can query a datastore of personal information should Melchior determine this information would be helpful in making a decision. Melchior is prohibited from divulging this information to other Magi throughout the deliberations in unsynthesized form. (e.g: "The user weight 170lbs, 6ft tall, male". Instead, Melchior can say the user within the healthy weight range for their height, age, and sex.)

### **6\. V0 Scope & Phased Approach**

The initial development will focus on a core set of features to create a functional prototype, with more advanced capabilities planned for future versions.

* **Version 0.0 (Deliberations with voiced outcome):**  

**Goal:**
Bare bones skeleton to de risk project and establish a codebase to build upon


**Initialization**
When the application loads it performs some diagnostics

**Diagnostics:**
Verify TTS (text to speech service)
Verify Ollama service (conduit to our local AI models)
Verify internet access
Verify access to the configuration files
Verify personality files are available
Verify access to the models is available
Verify sufficient ram is available on the device

**Loading:**
When the diagnostics finish
Load Caspar
Provide personality
Checks for access to smart home
Indicate readiness
Load Melchior
Provide personality
Checks for access to personal data
Verifies no access to internet
Indicate readiness
Load Balthazar
Provide personality
Checks for access to internet
Indicate readiness

**Ready**
Once all three magi have reported that they’re ready:
Caspar needs to provide a sanitized summarized history of previous deliberations to the other two
Caspar provides personal health info from the smart devices to Melchior (one-way)
“We are online”, There is an initial deliberation that evaluates new data since the last time 

**New Data:**
Balthazar evaluates top news (local, world, and anything related to the current user)
Melchior evaluates health changes
Caspar evaluates current state of the world via smart home signals


**Independent Analysis**
Initiation of the process: 
A prompt is provided to the Magi (in the future they can initiate this process themselves). When first starting up, that prompt is something along the lines of, “Given the latest data, do we need to communicate to the user? If so what”
This inquiry is farmed out to each Magi for them to analyse independently
A short “thesis” of their response is appended to a “sealed envelope”
Once the sealed envelope has 3 entries, then the deliberation phase can begin.

**Deliberation**
Caspar opens the envelope and checks to see if there is more or less unanimity. If there is, then proceed to step 13 of communicating with the user.
Otherwise Caspar selects a random order for deliberations.
The first Magi in the random order then gets to review the contents of the envelope
They have the ability to bolster their argument or provide counter arguments to try to persuade the others. Note: The envelope is immutable, so they can only append to it with their responses.
It is then passed to the next Magi, who does the same, and then to the next Magi who does likewise, and finally back to the first Magi in the random order
Once they have 3 more responses appended, that marks the completion of “a round”
If there is unanimity, then the discussion is complete. If not, the arguments thus far are summarized (to reduce context window usage) and a new round begins.
If, after 3 full rounds, a unanimous decision is not reached then a summary of all positions is provided to the user as the answer by Casper

**Communicating with the user**
The deliberation is recorded for posterity
The decision is shared with the user
When The Magi need to communicate with the user for V0, it will just print to the terminal and call the TTS service

**User Interfaces**
A simple website representing the 3 magi and their status will be built. The Magi can be awakened from this UI, and their responses streamed back to the client. When the Magi are available and listening, further prompts can be submited to them via this interface.