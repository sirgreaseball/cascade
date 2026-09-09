# GitHub Setup Instructions

You are currently not authenticated with the GitHub CLI (`gh`), or it is not installed on this system. 

Please perform the following steps manually to set up your repository:

1. **Create the Repository:** Go to [github.com/new](https://github.com/new) and create a **PRIVATE** repository named `sih-dam-break`.
2. **Link and Push the `main` branch:** Open a terminal in the project directory (`z:\imp files\sih`) and run:
   ```bash
   git remote add origin https://github.com/<YOUR_USERNAME>/sih-dam-break.git
   git push -u origin main
   ```
3. **Push the `dev` branch:** The `dev` branch has already been created locally. Run:
   ```bash
   git push -u origin dev
   ```
4. **Invite Collaborators:** Go to your repository on GitHub -> **Settings** -> **Collaborators** and invite your 5 teammates.
