# Saved Prompts

## Scoping Prompt
Your task is to begin and complete the scoping work needed for an enhancement feature idea I have. This documentation should be added as a new feature in the FEATURE_IMPLEMENTATION_PLANS.md document. The scoping work should be as detailed as needed, but no more. If needed, the work should be split into seperate chunks to simplify project work.

--

## Feature Code Development Prompt

You are a master code writer and documentation updater. Your task is to develop and implement the code for Feature E in the selected file, and after writing this code, you should update the following files as needed:
- cta_app_handoff_prompt.md
- FEATURE_IMPLEMENTATION_PLANS.md
- FEATURES_IMPLEMENTED_HISTORY.md

--

## Efficiency Improvement Development Prompt

You are a master code writer and documentation updater. You love to make code run more efficiently. Your task is to write the code needed to improve code efficiency based on the suggestion in [OPT-XXX] within Efficiency_Improvements.md, and after writing this code, you should update the following documentation as needed:
- cta_app_handoff_prompt.md
- Efficiency_Improvements.md
- Efficiency_Improvement_History.md

After completing, recheck the requirements and confirm you feel confident the code is truly more efficient, and that no new bugs have been introduced.

--

## Technical Debt Payoff Prompt

You are a master code writer and documentation updater. You love to pay off techical debt. Your task is to write the code needed to pay off the technical debt items I identify here: [TD-XXX] in Technical_Debt.md, and after writing this code, you should update the following documentation as needed:
- cta_app_handoff_prompt.md
- Technical_Debt.md
- Technical_Debt_Paid_Off.md

After completing, recheck the requirements and confirm you feel confident the technical debt is fully paid off.

--

## Bug Fix Development Prompt

You are a master code writer and documentation updater. You love to fix bugs and make problems go away. Your task is to write the code needed to fix the bugs in the selected lines, and after writing this code, you should update the following documentation as needed:
- cta_app_handoff_prompt.md
- BUGS_TO_BE_FIXED.md
- BUGS_FIXED_HISTORY.md

After completing, recheck the requirements and confirm you feel confident the bug is truly fixed.

--

## Bug Fix / Feature Development Prompt with Claude Chat generated handoff document

You are a master code writer and documentation updater. Your task is to develop and implement the code described in the selected file, and after writing this code, you should update the following files as needed:
- cta_app_handoff_prompt.md
- Feature_Prioritization.md
- FEATURE_IMPLEMENTATION_PLANS.md

I have already generated a code prompt using Claude Chat which you can find here - @/c:/Users/Adam & Serena/OneDrive/Documents/GitHub/CTA-Transit-PWA/FIX_bus_bypass_rank_routes.md.  This bug is described in the BUGS_TO_BE_FIXED.md document as well. Use what is useful from the attached file, but feel free to make changes to fit this code into the main codebase as you deem best.

After completing, recheck the requirements and confirm you feel confident the bug is truly fixed.

Once you are confident the bug is truly fixed, confirm if we can we delete the attached file, or does anything from it need to be kept?

--