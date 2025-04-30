# PORTFOLIO: [https://jchisholm204.github.io/](https://jchisholm204.github.io/)


![jchisholm204's Stats](https://github-readme-stats.vercel.app/api?username=jchisholm204&theme=vue-dark&show_icons=true&hide_border=true&count_private=true)


![jchisholm204's Streak](https://github-readme-streak-stats.herokuapp.com/?user=jchisholm204&theme=vue-dark&hide_border=true)


![jchisholm204's Top Languages](https://github-readme-stats.vercel.app/api/top-langs/?username=jchisholm204&theme=vue-dark&show_icons=true&hide_border=true&layout=compact)

# Setup
The following instructions detail how to host this site locally.
Please note that I have only tested these instructions to work on Fedora 40/41.

1. Install the Deps

```bash
sudo dnf install ruby ruby-devel redhat-rpm-config gcc make @development-tools
```

2. Export the Deps

```bash
export GEM_HOME="$HOME/.gem"
export PATH="$HOME/.gem/bin:$PATH"
```

3. Install the site launcher

```bash
gem install jekyll bundler
```

4. Install Site Deps

```bash
bundle install
```

5. Run the site

```bash
bundle exec jekyll serve
```

6. Visit the locally hosted site at [http://localhost:4000](http://localhost:4000)
