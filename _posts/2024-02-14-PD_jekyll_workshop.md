---
title: "EngSoc PD: Jekyll Portfolio Workshop"
date: 2024-1-4
categories:
tags:
  - Jekyll
  - Queen's University
author: Jacob
---

This article serves as the technical instruction document for the Queen's EngSoc Professional Development Workshop on setting up a Jekyll based portfolio website.

## Introduction
If your reading this page, then you already know what a Jekyll website is, because your reading this tutorial on one. This is my portfolio site that I set up nearly a year ago. This document serves as a tutorial on how to set up one of these sites for yourself.

## Purpose
You might be wondering why having a portfolio site is useful, or why you would want to host one using Jekyll. Hopefully these questions will be answered below.

### Your Own Digital Portfolio
For me, having all of my projects saved in this portfolio is a way for me to remember what I did months or even years back. With a well written portfolio, you can look through your old projects and see how you accomplished your goals and the decisions you made along the way. Having a digital portfolio can also be used as a cool way to show off your projects to friends or even potential employers.

### Why Jekyll
Jekyll is a free and open-source Markdown formatter. Using Jekyll allows you to spend less time fixing how your portfolio looks and more time on your projects and the content you display. Writing an article to post on your Jekyll site is as easy as writing in Microsoft Word!
```md
## Example Title
See! Its as easy as this. I can write plain text and jekyll will format this into a code block.
```
You can also create code blocks for a variety of other languages like C.

```c
int main(){
    return 0;
}
```

Or VHDL.

```vhdl
library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

entity debounce is
  generic(
    clkFreq : integer := 50e6
  );
  port(
    i_clk    : in  std_logic;
    i_button : in  std_logic;
    o_button : out std_logic
  );
end entity;

architecture behavioral of debounce is

begin
end architecture;
```

Markdown also supports inline code `like this` as well as *italics* and **bolded text**.

You can also imbed [links](https://www.youtube.com/watch?v=dQw4w9WgXcQ) and images.

![RickRoll](https://i.insider.com/602ee9ced3ad27001837f2ac?width=700)

## Getting Started
The first step to getting started is to create a Github Account. After that, download and sign into GitHub Desktop. This will be the simplest way to manage your portfolio.

### Step 1
Head over to the [Chirpy Template GitHub Repository](https://github.com/cotes2020/jekyll-theme-chirpy). Click the button <kbd>Use this template</kbd> > <kbd>Create a new repository</kbd>, and name the new repository `USERNAME.github.io`, where `USERNAME` represents your GitHub username. Be careful as this is case sensitive.

### Step 2
Now we need to set up github actions to deploy our site. Open up the repository you just cloned, navigate over to settings and pages. Select "Deploy from GitHub Actions" and "Use Recommended Action." It should read something along the lines of deploy Jekyll Site.

Once you have set up the GitHub Action, navigate over to the "Actions" tab on your repository. Select "Deploy Jekyll site to Pages" and select the deployment. You should be greeted with something similar to the following screen:

![Deployment Img](assets/pd_jekyll/build.png)

Click on the URL and verify that everything initialized correctly.

### Step 3
Now that you have set up your site, its time to include all of your personal details. This is done by editing the `_config.yml` file in the source directory of your site. The most important ones to edit are included below:

```yml
title: Jacob Chisholm # the main title

tagline: Computer Engineering Student with an interest in embedded development # it will display as the sub-title

description: >- # used by seo meta and the atom feed
  Jacob Chisholm's Personal Project Portfolio

# Fill in the protocol & hostname for your site.
# e.g. 'https://username.github.io', note that it does not end with a '/'.
url: "https://jchisholm204.github.io"

github:
  username: jchisholm204 # change to your github username

social:
  # Change to your full name.
  # It will be displayed as the default author of the posts and the copyright owner in the Footer
  name: Jacob Chisholm
  email: jacobchisholm1010@gmail.com # change to your email address
  links:
    # The first element serves as the copyright owner's link
    # - https://twitter.com/username # change to your twitter homepage
    - https://github.com/jchisholm204 # change to your github homepage
    # Uncomment below to add more social links
    # - https://www.facebook.com/username
    - https://www.linkedin.com/in/jchisholm204

# the avatar on sidebar, support local or CORS resources
avatar: "/assets/me.jpg"
```

Almost all of the other fields can be left unchanged.

### Step 4
Edit the other `yml` files. These files can be found under the `_data` folder and are fairly self explanatory.

## Writing a Post
Now onto the main event: Writing articles for your portfolio. Everything you write must go under the `_posts` directory or they will not be added to your portfolio. Every post also has a specific naming convention. All posts have the format `YYYY-MM-DD-Post_Title.md` where `Post_Title` is the name of your article.

Additionally, all posts must include a section at the top to help identify them.

```md
---
title: "Your Title"
date: YYYY-MM-DD
categories: [Category1, Category2]
tags: [tag1, tag2]
author: Jacob
image:
  path: /assets/project_img.png
  alt: An image of my project
---
```

## Conclusion
Now you should have everything you need to write your first post using your Jekyll site. If you ever need help with Markdown, [this site is a great reference](https://www.markdownguide.org/basic-syntax/). Markdown also supports inline HTML and CSS for anyone wanting to add something extra to a post.