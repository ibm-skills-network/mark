# Author Module Pre-Production Checklist

## Basic Assignment Configuration
- [ ] Assignment title can be set and saved correctly
- [ ] Introduction text editor works (formatting, saving)
- [ ] Instructions text editor works (formatting, saving)
- [ ] Grading criteria overview editor works (formatting, saving)
- [ ] Form validation displays appropriate error messages

## Assignment Settings
- [ ] Assignment type toggle (Graded vs Practice) works correctly
- [ ] Time settings (estimate vs strict limit) function properly
- [ ] Number of attempts can be set (including unlimited option)
- [ ] Passing grade threshold can be configured
- [ ] Question display option (one per page vs all) works
- [ ] Question order option (defined vs random) works
- [ ] Feedback settings (full, partial, none) correctly save

## Question Management
- [ ] Question creation works for all question types:
  - [ ] Multiple Choice (single correct)
  - [ ] Multiple Select (multiple correct)
  - [ ] True/False
  - [ ] Text Response
  - [ ] URL Link
  - [ ] Upload
  - [ ] File or Link
- [ ] Questions can be deleted
- [ ] Questions can be duplicated
- [ ] Questions can be reordered via drag and drop
- [ ] Table of contents navigation works correctly
- [ ] Question collapse/expand functionality works
- [ ] Question titles can be edited

## Multiple Choice/Select Questions
- [ ] Can add/remove/edit answer choices
- [ ] Can mark correct answer(s)
- [ ] Can assign points to choices
- [ ] Can add feedback for choices
- [ ] Randomized choice order toggle works
- [ ] Choice reordering via arrows works

## Text Response Questions
- [ ] Character/word limits can be set and switched between
- [ ] Rubrics can be created and edited
- [ ] Points allocation works correctly

## True/False Questions
- [ ] Can set correct answer (True or False)
- [ ] Points allocation works

## Video/Live Recording Questions (Beta)
- [ ] Slide quality assessment toggle works (Presentation)
- [ ] Time management evaluation toggle works (both types)
- [ ] Body language assessment toggle works (Live Recording)
- [ ] Real-time AI coach toggle works (Live Recording)
- [ ] Target time setting works correctly

## Rubric Management
- [ ] Create blank rubrics
- [ ] AI-generated rubrics
- [ ] Add criteria to rubrics
- [ ] Remove criteria from rubrics
- [ ] Edit criteria descriptions
- [ ] Assign points to criteria
- [ ] Multiple rubrics per question
- [ ] "Show rubrics to learner" toggle works

## Question Variants
- [ ] Create blank variants
- [ ] Generate variants with AI
- [ ] Edit variants independently
- [ ] Delete variants
- [ ] Mass variant generation across questions

## AI Integration
- [ ] Mark chat opens and responds
- [ ] Context awareness (recognizes current question)
- [ ] Generate questions from learning objectives
- [ ] Improve existing questions
- [ ] Create rubrics via chat
- [ ] Operation execution from chat works

## Navigation & Flow
- [ ] Navigation between setup steps works correctly
- [ ] "Next" button validation works as expected
- [ ] Form validation prevents proceeding with invalid data
- [ ] Progress is maintained when navigating between sections

## Preview & Publication
- [ ] "Preview" button shows accurate learner view
- [ ] "Save & Publish" button works correctly
- [ ] Unpublished changes are indicated clearly
- [ ] Publication progress indicator works
- [ ] Success page appears after successful publication
- [ ] "Sync with latest" button works correctly

## Error Handling
- [ ] Form validation errors are clear and accurate
- [ ] Network errors show appropriate messages
- [ ] Unsaved changes warning appears when navigating away
- [ ] Recovery works if browser is closed unexpectedly

## Browser Compatibility
- [ ] All features work in Chrome
- [ ] All features work in Firefox
- [ ] All features work in Safari
- [ ] All features work in Edge

## Responsive Design
- [ ] Interface works on desktop
- [ ] Interface adapts to tablet size
- [ ] Critical functionality works on mobile devices

## Performance
- [ ] Page loads quickly
- [ ] Editing many questions doesn't cause lag
- [ ] Large assignments with many questions load correctly
- [ ] AI operations complete in reasonable time

## Data Integrity
- [ ] All changes save correctly to backend
- [ ] Refreshing the page retains data
- [ ] No unexpected data loss during editing
- [ ] Question IDs remain consistent

## Accessibility
- [ ] Keyboard navigation works
- [ ] Screen readers can access all content
- [ ] Color contrast meets accessibility standards
- [ ] Error messages are accessible

## Final Checks
- [ ] All console errors are fixed
- [ ] No React key warnings
- [ ] No memory leaks
- [ ] All API endpoints return expected results
- [ ] End-to-end test from creation to learner view